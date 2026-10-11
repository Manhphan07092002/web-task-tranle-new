import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { levelOf, LEVELS } from '../../utils/rbac';
import { Link } from 'react-router-dom';
import { ClipboardCheck, PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, RotateCcw } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockCounts, getStockCount, openStockCount, submitCountLines,
  requestRecount, approveCount, cancelCount, getWarehouses,
  type StockCount, type Warehouse,
} from '../../services/stockService';import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Kiểm kê blind-count (§19–20): NV đếm không thấy số hệ thống,
// TP đối chiếu/duyệt chênh lệch → sinh điều chỉnh tồn.
export default function CountPage({ deptKey }: { deptKey: DeptKey }) {
  const { user } = useAuth();
  const canManage = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockCount | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [c, w] = await Promise.all([
        getStockCounts(),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setCounts(c); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được kiểm kê');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openDetail = async (id: string) => {
    try {
      setSelected(await getStockCount(id));
    } catch (e: any) {
      setError(e.message || 'Không mở được đợt kiểm kê');
    }
  };

  const refreshSelected = async (id: string) => {
    try {
      setSelected(await getStockCount(id));
      await fetchAll();
    } catch (e: any) {
      setError(e.message || 'Tải lại thất bại');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Vận hành</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Kiểm kê</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          <button hidden={!canManage} onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
            <PlusCircle size={16} /> Mở đợt kiểm kê
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
          <p className="text-gray-400 text-sm">Đang tải kiểm kê...</p>
        </div>
      ) : counts.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <ClipboardCheck size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa có đợt kiểm kê nào</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {counts.map((c) => (
            <button key={c.id} onClick={() => openDetail(c.id)} className="text-left">
              <Card className="p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-gray-800">{c.code || c.id.slice(0, 8)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${c.status === 'DONE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {c.status === 'DONE' ? 'Đã đóng' : c.status === 'CANCELLED' ? 'Đã hủy' : 'Đang đếm'}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {c.warehouseName || c.warehouseId} · {c.blindCount ? 'Đếm mù' : 'Hiện số hệ thống'} · {c.createdAt ? new Date(c.createdAt).toLocaleString('vi-VN') : ''}
                </p>
              </Card>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <CountDetailModal
          count={selected} onClose={() => setSelected(null)}
          onChanged={() => refreshSelected(selected.id)} onError={setError} />
      )}
      {showCreate && (
        <CountCreateModal warehouses={warehouses}
          onClose={() => setShowCreate(false)}
          onDone={async () => { setShowCreate(false); await fetchAll(); }} />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function CountDetailModal({ count, onClose, onChanged, onError }: {
  count: StockCount; onClose: () => void; onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const { user } = useAuth();
  const canManage = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const open = count.status === 'COUNTING';
  const blind = count.blindCount;

  const fail = (m: string) => { setErr(m); onError(m); };

  const submitActuals = async () => {
    const lines = Object.entries(actuals)
      .filter(([, v]) => v !== '')
      .map(([key, v]) => {
        const line = count.lines?.find((l) => l.id === key);
        return { productId: line?.productId || '', locationId: line?.locationId || null, actualQty: Number(v) };
      })
      .filter((l) => l.productId && l.actualQty >= 0);
    if (lines.length === 0) { setErr('Nhập ít nhất 1 số đếm.'); return; }
    setBusy(true); setErr('');
    try {
      await submitCountLines(count.id, lines);
      setActuals({});
      await onChanged();
    } catch (e: any) {
      fail(e.message || 'Gửi số đếm thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const doRecount = async () => {
    if (checked.length === 0) { setErr('Chọn dòng cần kiểm lại.'); return; }
    setBusy(true); setErr('');
    try {
      await requestRecount(count.id, checked);
      setChecked([]);
      await onChanged();
    } catch (e: any) {
      fail(e.message || 'Yêu cầu kiểm lại thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const doApprove = async () => {
    setBusy(true); setErr('');
    try {
      await approveCount(count.id);
      await onChanged();
    } catch (e: any) {
      fail(e.message || 'Duyệt thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true); setErr('');
    try { await cancelCount(count.id); await onChanged(); }
    catch (e: any) { fail(e.message || 'Hủy kiểm kê thất bại.'); }
    finally { setBusy(false); }
  };

  const varianceOf = (l: { expectedQty: number | null; actualQty: number | null }) =>
    l.actualQty == null || l.expectedQty == null ? null : Number(l.actualQty) - Number(l.expectedQty);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 font-mono">{count.code || count.id.slice(0, 8)}</h3>
            <p className="text-xs text-gray-400">{count.warehouseName || count.warehouseId} · {blind ? 'Đếm mù (không hiện số hệ thống)' : 'Hiện số hệ thống'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {err && <div className="flex items-center gap-2 p-3 mb-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="py-2">Hàng</th>
                {!blind && <th className="py-2 text-right">Hệ thống</th>}
                <th className="py-2 text-right">Thực tế</th>
                <th className="py-2 text-right">Chênh lệch</th>
                <th className="py-2 text-right">Kiểm lại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(count.lines || []).map((l) => {
                const v = varianceOf(l);
                return (
                  <tr key={l.id}>
                    <td className="py-2.5 pr-2">
                      <p className="font-medium text-gray-800 text-[13px]">{l.productName || l.productId}</p>
                    </td>
                    {!blind && <td className="py-2.5 text-right text-gray-400">{l.expectedQty ?? '—'}</td>}
                    <td className="py-2.5 text-right">
                      {l.actualQty != null && !open ? (
                        <span className="font-bold text-gray-800">{l.actualQty}</span>
                      ) : open ? (
                        <input type="number" min={0} step="any" placeholder={l.actualQty?.toString() || '—'}
                          value={actuals[l.id] ?? ''}
                          onChange={(e) => setActuals((a) => ({ ...a, [l.id]: e.target.value }))}
                          className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right outline-none" />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {v == null ? <span className="text-gray-300">—</span>
                        : v === 0 ? <span className="text-emerald-600 font-bold text-xs">Khớp</span>
                          : <span className={`font-bold text-xs ${v > 0 ? 'text-blue-600' : 'text-red-500'}`}>{v > 0 ? '+' : ''}{v}</span>}
                    </td>
                    <td className="py-2.5 text-right">
                      {open && (
                        <input type="checkbox" checked={checked.includes(l.id)}
                          onChange={() => setChecked((c) => (c.includes(l.id) ? c.filter((x) => x !== l.id) : [...c, l.id]))}
                          className="w-4 h-4 rounded border-gray-300" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0 flex-wrap">
            <button onClick={submitActuals} disabled={busy}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {busy ? 'Đang gửi...' : 'Gửi số đếm'}
            </button>
            {canManage && <><button onClick={doRecount} disabled={busy}
              className="px-4 py-2 border border-gray-200 hover:bg-gray-100 rounded-xl font-bold text-sm text-gray-600 disabled:opacity-60 flex items-center gap-1.5">
              <RotateCcw size={14} />Yêu cầu kiểm lại
            </button>
            <button onClick={doApprove} disabled={busy}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 flex items-center gap-1.5">
              <CheckCircle2 size={14} />Duyệt chênh lệch
            </button>
            <button onClick={doCancel} disabled={busy} className="px-4 py-2 border rounded-xl text-red-600">Hủy đợt kiểm kê</button></>}
          </div>
        )}
      </div>
    </div>
  );
}

function CountCreateModal({ warehouses, onClose, onDone }: {
  warehouses: { id: string; name: string }[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [blind, setBlind] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId) { setErr('Chọn kho kiểm kê.'); return; }
    setSaving(true); setErr('');
    try {
      await openStockCount({ warehouseId, blindCount: blind });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Mở đợt thất bại (cần cấp TP).');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Mở đợt kiểm kê</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
              <option value="">-- Chọn kho --</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
            Đếm mù (NV không thấy số hệ thống)
          </label>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang mở...' : 'Mở đợt (chụp tồn hiện tại)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
