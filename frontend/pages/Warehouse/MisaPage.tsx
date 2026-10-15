import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCcw, PlusCircle, RefreshCw, AlertCircle, X, Trash2 } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getMisaMappings, createMisaMapping, deleteMisaMapping, getMisaLogs,
  type MisaMapping, type MisaSyncLog,
} from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const ENTITY_TYPES = ['product', 'warehouse', 'document'];

// Đối soát MISA (§30.6 + §35): quản trị mapping trước, sync thật khi có endpoint.
// Tuyệt đối không tự tạo mapping mơ hồ, không adjust chỉ để khớp số.
export default function MisaPage({ deptKey }: { deptKey: DeptKey }) {
  const [tab, setTab] = useState<'mapping' | 'logs'>('mapping');
  const [mappings, setMappings] = useState<MisaMapping[]>([]);
  const [logs, setLogs] = useState<MisaSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [m, l] = await Promise.all([getMisaMappings(), getMisaLogs().catch(() => [] as MisaSyncLog[])]);
      setMappings(m); setLogs(l);
    } catch (e: any) {
      setError(e.message || 'Không tải được dữ liệu MISA');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const remove = async (id: string) => {
    try {
      await deleteMisaMapping(id);
      await fetchAll();
    } catch (e: any) {
      setError(e.message || 'Xóa thất bại');
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Đối soát MISA</h1>
          <p className="text-gray-500 text-sm mt-1">MISA là nguồn kế toán/đối soát — Tran Le chỉ vận hành chi tiết, không sao chép màn hình MISA.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-gray-100 rounded-xl p-1">
            {([['mapping', 'Mapping'], ['logs', 'Nhật ký']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${tab === id ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          {tab === 'mapping' && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
              <PlusCircle size={16} /> Thêm mapping
            </button>
          )}
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
          <p className="text-gray-400 text-sm">Đang tải...</p>
        </div>
      ) : tab === 'mapping' ? (
        mappings.length === 0 ? (
          <Card className="py-16 text-center text-gray-400">
            <RefreshCcw size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
            <p className="font-medium">Chưa có mapping nào</p>
            <p className="text-sm mt-1">Khai báo ánh xạ mã nội bộ ↔ mã MISA trước khi bật đồng bộ.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Đối tượng</th>
                    <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Mã nội bộ</th>
                    <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Mã MISA</th>
                    <th className="text-right py-2 px-5 text-xs font-bold text-gray-500 uppercase">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mappings.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50/70">
                      <td className="py-2 px-5 text-gray-500 text-xs">{m.entityType}</td>
                      <td className="py-2 px-4 font-mono text-xs text-gray-700">{m.entityId}</td>
                      <td className="py-2 px-4">
                        <span className="font-mono font-bold text-gray-800 text-xs">{m.misaCode}</span>
                        {m.misaName && <span className="text-xs text-gray-400 ml-2">{m.misaName}</span>}
                      </td>
                      <td className="py-2 px-5 text-right">
                        <button onClick={() => remove(m.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Xóa mapping">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : logs.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <p className="font-medium">Chưa có lượt đồng bộ nào</p>
          <p className="text-sm mt-1">Nhật ký idempotent sẽ hiện ở đây khi bật sync.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Thời gian</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Chiều · Đối tượng</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Lỗi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50/70">
                    <td className="py-2 px-5 text-xs text-gray-500">{l.createdAt ? new Date(l.createdAt).toLocaleString('vi-VN') : ''}</td>
                    <td className="py-2 px-4 text-xs text-gray-600">{l.direction} · {l.entityType}</td>
                    <td className="py-2 px-4"><span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">{l.status}</span></td>
                    <td className="py-2 px-5 text-xs text-red-500 max-w-[280px] truncate" title={l.error || ''}>{l.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCreate && (
        <MappingModal onClose={() => setShowCreate(false)} onDone={async () => { setShowCreate(false); await fetchAll(); }} />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function MappingModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [entityType, setEntityType] = useState('product');
  const [entityId, setEntityId] = useState('');
  const [misaCode, setMisaCode] = useState('');
  const [misaName, setMisaName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityId.trim() || !misaCode.trim()) { setErr('Nhập ID nội bộ và mã MISA.'); return; }
    setSaving(true); setErr('');
    try {
      await createMisaMapping({ entityType, entityId: entityId.trim(), misaCode: misaCode.trim(), misaName: misaName.trim() || undefined });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Tạo thất bại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Thêm mapping MISA</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Loại đối tượng</label>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">ID nội bộ</label>
            <input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="VD: prod-pin-01"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã MISA</label>
              <input value={misaCode} onChange={(e) => setMisaCode(e.target.value)} placeholder="VD: VT-0001"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên MISA</label>
              <input value={misaName} onChange={(e) => setMisaName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : 'Thêm mapping'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
