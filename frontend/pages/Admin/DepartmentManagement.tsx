import { apiFetch } from '../../services/api';
import { AdminToastBar, AdminDeleteModal, type AdminToastData } from '../../components/admin/AdminFeedback';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, PlusCircle, Edit2, Trash2, RefreshCw, AlertCircle,
  X, Save, Users, CheckSquare, Crown, ChevronDown
} from 'lucide-react';

interface Department {
  id: string;
  name: string;
  description: string;
  color: string;
  managerId: string | null;
  code?: string | null;
  parentId?: string | null;
  parentName?: string | null;
  level?: number | null;
  isActive?: number | null;
  userCount: number;
  taskCount: number;
  manager: { id: string; name: string; avatar: string } | null;
}

interface UserOption { id: string; name: string; avatar: string; role: string; department: string; managementLevel?: number; }

const LEVEL_LABELS: Record<number, string> = { 1: 'Cấp 1 · Ban Giám đốc', 2: 'Cấp 2 · Phòng chính', 3: 'Cấp 3 · Tổ/nhóm' };

const PRESET_COLORS = [
  '#ef4444','#f97316','#eab308','#10b981',
  '#3b82f6','#8b5cf6','#ec4899','#06b6d4',
  '#84cc16','#f59e0b','#6366f1','#14b8a6',
];

// ---- Form Modal ----
const DeptFormModal: React.FC<{
  dept: Department | null;
  depts: Department[];
  users: UserOption[];
  onClose: () => void;
  onSave: (data: Partial<Department>) => Promise<void>;
}> = ({ dept, depts, users, onClose, onSave }) => {
  const isEdit = !!dept;
  const [name, setName]       = useState(dept?.name || '');
  const [desc, setDesc]       = useState(dept?.description || '');
  const [color, setColor]     = useState(dept?.color || '#3b82f6');
  const [mgr, setMgr]         = useState(dept?.managerId || '');
  const [code, setCode]       = useState(dept?.code || '');
  const [parentId, setParentId] = useState(dept?.parentId || '');
  const [active, setActive]   = useState((dept?.isActive ?? 1) === 1);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  // Cấp tự suy từ phòng cha (BGD=1, phòng chính=2, tổ/nhóm=3)
  const parentLevel = depts.find(d => d.id === parentId)?.level ?? null;
  const level = !parentId ? 1 : (parentLevel != null ? Math.min(parentLevel + 1, 3) : 2);
  // Chỉ gợi ý trưởng phòng từ cấp TP trở lên, giữ người đang giữ chức dù không đủ chuẩn
  const eligibleManagers = users.filter(u => (u.managementLevel ?? 10) >= 20 || u.id === mgr);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Tên phòng ban không được trống.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ id: dept?.id, name: name.trim(), description: desc, color, managerId: mgr || null, code: code.trim().toUpperCase() || null, parentId: parentId || null, level, isActive: active ? 1 : 0 });
      onClose();
    } catch (e: any) { setErr(e.message || 'Lưu thất bại.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl"
          style={{ background: `linear-gradient(135deg, ${color}ee, ${color}99)` }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <Building2 size={16} className="text-white" />
            </div>
            <h3 className="text-white font-bold">{isEdit ? 'Chỉnh sửa phòng ban' : 'Thêm phòng ban mới'}</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={20} /></button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}

          {/* Name & Color */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên phòng ban <span className="text-red-500">*</span></label>
              <input required value={name} onChange={e => setName(e.target.value)}
                placeholder="Ví dụ: Kế toán, R&D..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Màu sắc</label>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl border-2 border-gray-200 relative overflow-hidden flex-shrink-0 cursor-pointer" style={{ backgroundColor: color }}>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                </div>
                <input type="text" value={color} onChange={e => setColor(e.target.value)}
                  className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-blue-200 outline-none min-w-0" />
              </div>
            </div>
          </div>

          {/* Color Presets */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Màu nhanh</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-lg transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mô tả</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              placeholder="Chức năng và nhiệm vụ của phòng ban..."
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none text-sm resize-none" />
          </div>

          {/* Manager */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Trưởng phòng (tùy chọn)</label>
            <div className="relative">
              <Crown className="absolute left-3 top-2.5 text-gray-400 pointer-events-none" size={15} />
              <select value={mgr} onChange={e => setMgr(e.target.value)}
                className="w-full pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-blue-200 outline-none appearance-none">
                <option value="">-- Chưa có trưởng phòng --</option>
                {eligibleManagers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role} · LV {u.managementLevel ?? 10})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={13} />
            </div>
            <p className="text-xs text-gray-400 mt-1">Chỉ hiện nhân sự cấp TP trở lên (LV ≥ 20).</p>
          </div>

          {/* Code / Parent / Level / Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã phòng</label>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="VD: KT, KD, KHO"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Cấp (tự tính)</label>
              <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700">
                {LEVEL_LABELS[level] || `Cấp ${level}`}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Trực thuộc</label>
              <div className="relative">
                <select value={parentId} onChange={e => setParentId(e.target.value)}
                  className="w-full px-4 pr-8 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-blue-200 outline-none appearance-none">
                  <option value="">-- Không (cấp cao nhất) --</option>
                  {depts.filter(d => d.id !== dept?.id).map(d => (
                    <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={13} />
              </div>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                Đang hoạt động
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 text-white rounded-xl font-bold text-sm shadow-md transition-all disabled:opacity-60 flex items-center gap-2"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang lưu...</> : <><Save size={14} />{isEdit ? 'Lưu thay đổi' : 'Thêm phòng ban'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---- Main Page ----
export default function AdminDepartmentManagement() {
  const [depts, setDepts]     = useState<Department[]>([]);
  const [users, setUsers]     = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [editing, setEditing] = useState<Department | null | undefined>(undefined);
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast]     = useState<AdminToastData | null>(null);

  const showToast = (title: string, msg?: string, type: AdminToastData['type'] = 'success') => {
    setToast({ title, msg, type }); setTimeout(() => setToast(null), 3500);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [dr, ur] = await Promise.all([apiFetch('/api/departments'), apiFetch('/api/users')]);
      if (!dr.ok) throw new Error('Không thể tải phòng ban');
      setDepts(await dr.json());
      if (ur.ok) setUsers(await ur.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSave = async (data: Partial<Department>) => {
    const isNew = !data.id || !depts.find(d => d.id === data.id);
    const res = await apiFetch(isNew ? '/api/departments' : `/api/departments/${data.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Lỗi lưu');
    showToast(
      isNew ? `Đã thêm phòng "${data.name}"` : `Đã cập nhật "${data.name}"`,
      isNew ? 'Cơ cấu tổ chức đã ghi nhận phòng ban mới.' : 'Tên mới đã cascade sang nhân sự, công việc và báo cáo.',
    );
    await fetchAll();
  };

  const handleDelete = async () => {
    if (!deletingDept) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/departments/${deletingDept.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast(`Đã xóa phòng "${deletingDept.name}"`, 'Cơ cấu tổ chức đã được làm gọn.');
      await fetchAll();
    } catch (e: any) { showToast('Xóa phòng ban thất bại', e.message || 'Thử lại sau.', 'error'); }
    finally { setDeleting(false); setDeletingDept(null); }
  };

  const totalUsers = depts.reduce((s, d) => s + d.userCount, 0);
  const totalTasks = depts.reduce((s, d) => s + d.taskCount, 0);

  return (
    <div className="space-y-6 pb-8">
      <AdminToastBar toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl shadow-lg shadow-blue-200">
            <Building2 size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quản lý Phòng ban</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              <strong className="text-gray-700">{depts.length}</strong> phòng ban ·&nbsp;
              <strong className="text-gray-700">{totalUsers}</strong> nhân viên ·&nbsp;
              <strong className="text-gray-700">{totalTasks}</strong> công việc
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm"><RefreshCw size={16} /></button>
          <button onClick={() => setEditing(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-200 hover:shadow-blue-300 transition-all">
            <PlusCircle size={16} /> Thêm phòng ban
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center py-24 gap-3">
          <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải phòng ban...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-24 gap-3 text-red-500">
          <AlertCircle size={40} strokeWidth={1.5} /><p>{error}</p>
          <button onClick={fetchAll} className="px-4 py-2 bg-red-50 rounded-xl text-sm flex items-center gap-2"><RefreshCw size={14} />Thử lại</button>
        </div>
      ) : depts.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl py-20 text-center text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p>Chưa có phòng ban nào. Nhấn "Thêm phòng ban" để bắt đầu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {depts.map(dept => (
            <DeptCard key={dept.id} dept={dept}
              onEdit={() => setEditing(dept)}
              onDelete={() => setDeletingDept(dept)}
              deleting={deleting && deletingDept?.id === dept.id} />
          ))}
        </div>
      )}

      {/* Modal */}
      {editing !== undefined && (
        <DeptFormModal dept={editing} depts={depts} users={users} onClose={() => setEditing(undefined)} onSave={handleSave} />
      )}

      {/* Delete Confirmation Modal */}
      {deletingDept && (
        <AdminDeleteModal
          title="Xóa phòng ban?"
          itemName={deletingDept.name}
          itemSub={`${deletingDept.userCount} nhân viên · ${deletingDept.taskCount} công việc`}
          warning={deletingDept.userCount > 0 ? `Đang có ${deletingDept.userCount} nhân viên — cần di chuyển trước khi xóa.` : 'Công việc gắn tên phòng này sẽ mất liên kết hiển thị.'}
          confirmText="Xóa phòng ban"
          busy={deleting}
          onCancel={() => setDeletingDept(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

// ---- Department Card ----
const DeptCard: React.FC<{
  dept: Department;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}> = ({ dept, onEdit, onDelete, deleting }) => (
  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
    {/* Color bar */}
    <div className="h-1.5" style={{ backgroundColor: dept.color }} />

    <div className="p-5">
      {/* Title row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ backgroundColor: dept.color + '20' }}>
            <Building2 size={20} style={{ color: dept.color }} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-gray-900 text-base">{dept.name}</h3>
              {dept.code && (
                <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{dept.code}</span>
              )}
              {(dept.isActive ?? 1) === 0 && (
                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">NGƯNG</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {LEVEL_LABELS[dept.level ?? 2] || `Cấp ${dept.level ?? 2}`}
              {dept.parentName ? ` · thuộc ${dept.parentName}` : ' · cấp cao nhất'}
            </p>
            {dept.manager && (
              <div className="flex items-center gap-1.5 mt-1">
                <Crown size={11} style={{ color: dept.color }} />
                {dept.manager.avatar ? (
                  <img src={dept.manager.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-[8px] font-bold">
                    {dept.manager.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="text-xs text-gray-500">{dept.manager.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg" title="Sửa">
            <Edit2 size={14} />
          </button>
          <button onClick={onDelete} disabled={deleting || dept.userCount > 0}
            title={dept.userCount > 0 ? `Còn ${dept.userCount} nhân viên` : 'Xóa'}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed">
            {deleting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>

      {/* Description */}
      {dept.description && (
        <p className="text-sm text-gray-500 mb-4 leading-relaxed line-clamp-2">{dept.description}</p>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 pt-3 border-t border-gray-50">
        <div className="flex items-center gap-1.5 flex-1 justify-center py-2 rounded-xl"
          style={{ backgroundColor: dept.color + '10' }}>
          <Users size={14} style={{ color: dept.color }} />
          <span className="text-sm font-black" style={{ color: dept.color }}>{dept.userCount}</span>
          <span className="text-xs text-gray-400">nhân viên</span>
        </div>
        <div className="flex items-center gap-1.5 flex-1 justify-center py-2 bg-gray-50 rounded-xl">
          <CheckSquare size={14} className="text-gray-400" />
          <span className="text-sm font-black text-gray-700">{dept.taskCount}</span>
          <span className="text-xs text-gray-400">công việc</span>
        </div>
      </div>

      {/* Warning if has users: can't delete */}
      {dept.userCount > 0 && (
        <p className="text-[10px] text-gray-400 text-center mt-2">
          ⚠ Di chuyển nhân viên trước khi xóa phòng ban
        </p>
      )}
    </div>
  </div>
);
