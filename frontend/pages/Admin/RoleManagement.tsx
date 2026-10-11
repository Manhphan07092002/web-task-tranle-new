import { apiFetch } from '../../services/api';
import { AdminToastBar, AdminDeleteModal, type AdminToastData } from '../../components/admin/AdminFeedback';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, PlusCircle, Edit2, Trash2, RefreshCw, AlertCircle,
  CheckCircle, X, Save, Users, Lock, Plus, Minus, Settings
} from 'lucide-react';

// All available permissions in the system
const ALL_PERMISSIONS = [
  { id: 'admin_panel',          label: 'Truy cập Admin Panel',              group: 'Quản trị' },
  { id: 'manage_users',         label: 'Quản lý người dùng (CRUD)',         group: 'Quản trị' },
  { id: 'manage_meetings',      label: 'Quản lý tất cả cuộc họp',           group: 'Quản trị' },
  { id: 'manage_warehouse',     label: 'Quản lý Xuất/Nhập Kho',             group: 'Quản trị' },
  { id: 'view_all_tasks',       label: 'Xem tất cả công việc',              group: 'Công việc' },
  { id: 'manage_dept_tasks',    label: 'Giao/sửa việc trong phòng ban',     group: 'Công việc' },
  { id: 'view_own_tasks',       label: 'Xem công việc được giao',           group: 'Công việc' },
  { id: 'view_all_reports',     label: 'Xem tất cả báo cáo đã duyệt',      group: 'Báo cáo' },
  { id: 'approve_dept_reports', label: 'Duyệt báo cáo phòng ban',          group: 'Báo cáo' },
  { id: 'director_feedback',    label: 'Phản hồi Giám đốc cho báo cáo',    group: 'Báo cáo' },
  { id: 'create_report',        label: 'Tạo báo cáo tuần',                 group: 'Báo cáo' },
  { id: 'view_dept_users',      label: 'Xem danh sách nhân viên phòng ban', group: 'Nhân sự' },
  { id: 'join_meetings',        label: 'Tham gia cuộc họp',                group: 'Cuộc họp' },
  { id: 'create_revenue_report',label: 'Tạo báo cáo doanh thu',            group: 'Kinh doanh' },
  { id: 'approve_dept_revenue', label: 'Duyệt báo cáo doanh thu phòng ban', group: 'Kinh doanh' },
  { id: 'approve_all_revenue',  label: 'Duyệt tất cả báo cáo doanh thu',    group: 'Kinh doanh' },
];

const PERM_GROUPS = [...new Set(ALL_PERMISSIONS.map(p => p.group))];

// Cấp quản lý chuẩn hóa: 10 NV / 20 TP / 30 P.GĐ / 40 GĐ / 99 Admin (so sánh >=)
const MANAGEMENT_LEVELS = [
  { value: 10, label: 'Nhân viên (10)' },
  { value: 20, label: 'Trưởng phòng (20)' },
  { value: 30, label: 'Phó Giám đốc (30)' },
  { value: 40, label: 'Giám đốc (40)' },
  { value: 99, label: 'Admin (99)' },
];

const levelLabel = (v?: number) => MANAGEMENT_LEVELS.find(l => l.value === v)?.label || `Level ${v ?? 10}`;

interface Role {
  id: string;
  name: string;
  description: string;
  color: string;
  permissions: string[];
  managementLevel?: number;
  isSystem: number;
  userCount: number;
}

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#10b981',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
  '#84cc16', '#f59e0b', '#6366f1', '#14b8a6',
];

const ROLE_PRESETS = [
  {
    label: 'Admin',
    name: 'Admin',
    color: '#ef4444',
    managementLevel: 99,
    desc: 'Toàn quyền hệ thống: quản trị, cấu hình, và xem mọi dữ liệu.',
    perms: ['admin_panel', 'manage_users', 'manage_meetings', 'view_all_tasks', 'manage_dept_tasks', 'view_own_tasks', 'view_all_reports', 'approve_dept_reports', 'director_feedback', 'create_report', 'view_dept_users', 'join_meetings', 'create_revenue_report', 'approve_dept_revenue', 'approve_all_revenue', 'manage_warehouse']
  },
  {
    label: 'Giám đốc',
    name: 'Director',
    color: '#0f172a',
    managementLevel: 40,
    desc: 'Xem toàn bộ báo cáo, cung cấp phản hồi Giám đốc. Xem tiến độ công việc.',
    perms: ['view_all_reports', 'director_feedback', 'view_all_tasks', 'manage_meetings', 'join_meetings', 'approve_all_revenue', 'manage_warehouse']
  },
  {
    label: 'Phó giám đốc',
    name: 'Deputy Director',
    color: '#3b82f6',
    managementLevel: 30,
    desc: 'Hỗ trợ giám đốc điều phối các dự án và phòng ban được giao.',
    perms: ['view_all_reports', 'director_feedback', 'view_all_tasks', 'manage_dept_tasks', 'join_meetings', 'approve_dept_revenue']
  },
  {
    label: 'Trưởng phòng',
    name: 'Manager',
    color: '#16a34a',
    managementLevel: 20,
    desc: 'Quản lý nhân viên trong phòng ban, giao việc, duyệt báo cáo phòng ban và doanh thu.',
    perms: ['manage_dept_tasks', 'approve_dept_reports', 'view_dept_users', 'create_report', 'view_own_tasks', 'join_meetings', 'approve_dept_revenue', 'manage_warehouse']
  },
  {
    label: 'Nhân viên',
    name: 'Employee',
    color: '#f59e0b',
    managementLevel: 10,
    desc: 'Xem và thực hiện công việc được giao, tạo báo cáo tuần và doanh thu của bản thân.',
    perms: ['view_own_tasks', 'create_report', 'join_meetings', 'create_revenue_report']
  }
];

const RoleFormModal: React.FC<{
  role: Role | null;
  onClose: () => void;
  onSave: (r: Partial<Role> & { id?: string }) => Promise<void>;
}> = ({ role, onClose, onSave }) => {
  const isEdit = !!role;
  const isSystem = !!role?.isSystem;
  const isAdminRole = role?.name === 'Admin';
  const [name, setName]         = useState(role?.name || '');
  const [desc, setDesc]         = useState(role?.description || '');
  const [color, setColor]       = useState(role?.color || '#6366f1');
  const [level, setLevel]       = useState<number>(role?.managementLevel ?? 10);
  const [perms, setPerms]       = useState<string[]>(role?.permissions || []);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const togglePerm = (id: string) =>
    setPerms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSystem && !name.trim()) { setErr('Tên vai trò không được trống.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ id: role?.id, name: name.trim(), description: desc, color, managementLevel: isAdminRole ? 99 : level, permissions: perms });
      onClose();
    } catch (e: any) { setErr(e.message || 'Lưu thất bại.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '92vh' }}>
        {/* Fixed Header */}
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${color}dd, ${color}99)` }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <Shield size={16} className="text-white" />
            </div>
            <h3 className="text-white font-bold text-base">
              {isEdit ? `Chỉnh sửa vai trò${isSystem ? ' (Hệ thống)' : ''}` : 'Tạo vai trò mới'}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={20} /></button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
            {isSystem && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
                <Lock size={14} />Vai trò hệ thống: không thể đổi tên/xóa, nhưng có thể chỉnh sửa mô tả, màu sắc, cấp quản lý và quyền hạn.
              </div>
            )}

            {/* Presets */}
            {!isSystem && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Gợi ý phân quyền nhanh</label>
                <div className="flex flex-wrap gap-2">
                  {ROLE_PRESETS.map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        if (!name) setName(preset.name);
                        setColor(preset.color);
                        setDesc(preset.desc);
                        setPerms(preset.perms);
                        setLevel(preset.managementLevel);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all hover:bg-gray-50 flex items-center gap-1.5"
                      style={{ borderColor: preset.color + '40', color: preset.color, backgroundColor: preset.color + '10' }}
                    >
                      <Shield size={12} /> {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Level */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Cấp quản lý (so sánh {' >='})</label>
              <select value={level} onChange={e => setLevel(Number(e.target.value))} disabled={isAdminRole}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 outline-none text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500">
                {MANAGEMENT_LEVELS.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {isAdminRole
                  ? 'Admin cố định 99 (tách quản trị hệ thống/kinh doanh) — không thể đổi.'
                  : '10 NV · 20 Trưởng phòng · 30 Phó GĐ · 40 Giám đốc · 99 Admin. Gán user theo role sẽ sync level này.'}
              </p>
            </div>

            {/* Name & Color */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên vai trò {!isSystem && <span className="text-red-500">*</span>}</label>
                <input value={name} onChange={e => setName(e.target.value)} disabled={isSystem}
                  placeholder="Ví dụ: Kế toán, Trưởng nhóm..."
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 outline-none text-sm disabled:bg-gray-50 disabled:text-gray-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Màu sắc</label>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl border-2 border-gray-200 flex-shrink-0 cursor-pointer relative overflow-hidden" style={{ backgroundColor: color }}>
                    <input type="color" value={color} onChange={e => setColor(e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </div>
                  <input type="text" value={color} onChange={e => setColor(e.target.value)}
                    className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:ring-1 focus:ring-purple-300 outline-none" />
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
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mô tả vai trò</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
                placeholder="Mô tả quyền hạn và trách nhiệm của vai trò này..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-200 outline-none text-sm resize-none" />
            </div>

            {/* Permissions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Quyền hạn</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPerms(ALL_PERMISSIONS.map(p => p.id))}
                    className="text-xs text-purple-600 hover:underline flex items-center gap-1"><Plus size={11} />Chọn tất cả</button>
                  <span className="text-gray-300">|</span>
                  <button type="button" onClick={() => setPerms([])}
                    className="text-xs text-red-500 hover:underline flex items-center gap-1"><Minus size={11} />Bỏ chọn</button>
                </div>
              </div>
              <div className="space-y-3">
                {PERM_GROUPS.map(group => (
                  <div key={group} className="border border-gray-100 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{group}</div>
                    <div className="divide-y divide-gray-50">
                      {ALL_PERMISSIONS.filter(p => p.group === group).map(perm => {
                        const checked = perms.includes(perm.id);
                        return (
                          <label key={perm.id}
                            className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer hover:bg-gray-50 ${checked ? 'bg-purple-50/50' : ''}`}>
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all
                                ${checked ? 'border-transparent' : 'border-gray-300 bg-white'}`}
                              style={checked ? { backgroundColor: color } : {}}>
                              {checked && <CheckCircle size={12} className="text-white" />}
                            </div>
                            <input type="checkbox" checked={checked}
                              onChange={() => togglePerm(perm.id)} className="sr-only" />
                            <span className={`text-sm ${checked ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{perm.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl transition-colors">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-white rounded-xl font-bold text-sm shadow-md transition-all disabled:opacity-60 flex items-center gap-2"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang lưu...</> : <><Save size={14} />{isEdit ? 'Lưu thay đổi' : 'Tạo vai trò'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default function AdminRoleManagement() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null | undefined>(undefined);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [toast, setToast] = useState<AdminToastData | null>(null);

  const showToast = (title: string, msg?: string, type: AdminToastData['type'] = 'success') => {
    setToast({ title, msg, type }); setTimeout(() => setToast(null), 3500);
  };

  const fetchRoles = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch('/api/roles');
      if (!res.ok) throw new Error('Lỗi tải dữ liệu');
      setRoles(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const handleSave = async (data: Partial<Role> & { id?: string }) => {
    const isNew = !data.id || !roles.find(r => r.id === data.id);
    const res = await apiFetch(isNew ? '/api/roles' : `/api/roles/${data.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Lỗi lưu');
    showToast(
      isNew ? `Đã tạo vai trò "${data.name}"` : `Đã cập nhật vai trò "${data.name || ''}"`,
      isNew ? 'Vai trò mới sẵn sàng gán cho người dùng.' : 'Màu sắc, cấp quản lý và quyền hạn đã được làm mới.',
    );
    await fetchRoles();
  };

  const handleDelete = async () => {
    if (!roleToDelete) return;
    setDeletingId(roleToDelete.id);
    try {
      const res = await apiFetch(`/api/roles/${roleToDelete.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      showToast(`Đã xóa vai trò "${roleToDelete.name}"`, 'Vai trò tùy chỉnh đã gỡ khỏi hệ thống.');
      await fetchRoles();
    } catch (e: any) { showToast('Xóa vai trò thất bại', e.message || 'Vai trò đang có người dùng được gán.', 'error'); }
    finally { 
      setDeletingId(null); 
      setRoleToDelete(null);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <AdminToastBar toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-700 rounded-2xl shadow-lg shadow-violet-200">
            <Shield size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quản lý Vai trò</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              <strong className="text-gray-700">{roles.filter(r => r.isSystem).length}</strong> vai trò hệ thống ·&nbsp;
              <strong className="text-gray-700">{roles.filter(r => !r.isSystem).length}</strong> vai trò tùy chỉnh
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchRoles} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm"><RefreshCw size={16} /></button>
          <button onClick={() => setEditingRole(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-violet-200 hover:shadow-violet-300 transition-all">
            <PlusCircle size={16} /> Tạo vai trò mới
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3 text-sm text-blue-700">
        <Settings size={18} className="flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold mb-0.5">Hướng dẫn</p>
          <p className="text-blue-600">Vai trò <strong>Hệ thống</strong> (Admin 99, Director 40, Deputy Director 30, Manager 20, Employee 10) không thể đổi tên hoặc xóa. Bạn có thể chỉnh sửa màu sắc, mô tả, cấp quản lý và phân quyền. Vai trò tùy chỉnh có thể xóa khi chưa có người dùng nào được gán. Gán user theo role sẽ tự sync cấp quản lý.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-24 gap-3">
          <div className="w-10 h-10 border-4 border-violet-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải vai trò...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-24 gap-3 text-red-500">
          <AlertCircle size={40} strokeWidth={1.5} /><p>{error}</p>
          <button onClick={fetchRoles} className="px-4 py-2 bg-red-50 rounded-xl text-sm flex items-center gap-2"><RefreshCw size={14} />Thử lại</button>
        </div>
      ) : (
        <>
          {/* System Roles Section */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Lock size={12} /> Vai trò Hệ thống
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roles.filter(r => r.isSystem).map(role => (
                <RoleCard key={role.id} role={role} onEdit={() => setEditingRole(role)} onDelete={() => setRoleToDelete(role)} deletingId={deletingId} />
              ))}
            </div>
          </div>

          {/* Custom Roles Section */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Settings size={12} /> Vai trò Tùy chỉnh
            </h2>
            {roles.filter(r => !r.isSystem).length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-2xl py-16 text-center text-gray-400">
                <Shield size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
                <p className="font-medium mb-1">Chưa có vai trò tùy chỉnh</p>
                <p className="text-sm">Nhấn <strong>"Tạo vai trò mới"</strong> để thêm vai trò riêng cho công ty.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {roles.filter(r => !r.isSystem).map(role => (
                  <RoleCard key={role.id} role={role} onEdit={() => setEditingRole(role)} onDelete={() => setRoleToDelete(role)} deletingId={deletingId} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {editingRole !== undefined && (
        <RoleFormModal role={editingRole} onClose={() => setEditingRole(undefined)} onSave={handleSave} />
      )}

      {/* Delete Confirmation Modal */}
      {roleToDelete && (
        <AdminDeleteModal
          title="Xóa vai trò?"
          itemName={roleToDelete.name}
          itemSub={`${roleToDelete.userCount} người dùng đang mang vai trò này`}
          warning={roleToDelete.userCount > 0 ? 'Vai trò đang có người dùng — hệ thống sẽ từ chối xóa, hãy gán vai trò khác trước.' : undefined}
          confirmText="Xóa vai trò"
          busy={deletingId === roleToDelete.id}
          onCancel={() => setRoleToDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

// --- Role Card Component ---
const RoleCard: React.FC<{
  role: Role;
  onEdit: () => void;
  onDelete: () => void;
  deletingId: string | null;
}> = ({ role, onEdit, onDelete, deletingId }) => {
  const permLabels = role.permissions
    .map(pid => ALL_PERMISSIONS.find(p => p.id === pid)?.label)
    .filter(Boolean) as string[];

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
      {/* Color bar */}
      <div className="h-1.5" style={{ backgroundColor: role.color }} />

      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0" style={{ backgroundColor: role.color + '20' }}>
              <Shield size={20} style={{ color: role.color }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-gray-900">{role.name}</h3>
                {role.isSystem ? (
                  <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">HỆ THỐNG</span>
                ) : (
                  <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">TÙY CHỈNH</span>
                )}
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">LV {role.managementLevel ?? 10}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Users size={11} className="text-gray-400" />
                <span className="text-xs text-gray-400">{role.userCount} người dùng · {levelLabel(role.managementLevel)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={onEdit}
              className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors" title="Chỉnh sửa">
              <Edit2 size={14} />
            </button>
            <button
              disabled={!!role.isSystem || deletingId === role.id}
              onClick={onDelete}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title={role.isSystem ? 'Không thể xóa vai trò hệ thống' : 'Xóa'}>
              {deletingId === role.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        </div>

        {role.description && (
          <p className="text-sm text-gray-500 mb-3 leading-relaxed">{role.description}</p>
        )}

        {/* Permissions */}
        {permLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {permLabels.slice(0, 4).map(label => (
              <span key={label}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full border"
                style={{ color: role.color, borderColor: role.color + '40', backgroundColor: role.color + '10' }}>
                {label}
              </span>
            ))}
            {permLabels.length > 4 && (
              <span className="text-[11px] text-gray-400 px-2 py-0.5 rounded-full bg-gray-100">
                +{permLabels.length - 4} quyền khác
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Không có quyền nào được gán</p>
        )}
      </div>
    </div>
  );
};
