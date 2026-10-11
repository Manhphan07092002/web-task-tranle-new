import { apiFetch } from '../../services/api';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, PlusCircle, Edit2, Trash2, Shield, Briefcase,
  Search, RefreshCw, AlertCircle, X, Mail, User as UserIcon,
  CheckCircle, ChevronDown, Lock, Unlock, ImagePlus, KeyRound, Copy, ExternalLink, Link as LinkIcon
} from 'lucide-react';
import { User, UserRole } from '../../types';
import { AdminToastBar, AdminDeleteModal, type AdminToastData } from '../../components/admin/AdminFeedback';

interface RoleInfo {
  id: string; name: string; color: string; isSystem: number; managementLevel?: number;
}

const LEVEL_LABELS: Record<number, string> = { 10: 'Nhân viên', 20: 'Trưởng phòng', 30: 'Phó Giám đốc', 40: 'Giám đốc', 99: 'Admin' };
const levelLabel = (v?: number | null) => LEVEL_LABELS[v ?? 10] || `LV ${v ?? 10}`;

interface PasswordResetRequest {
  id: string;
  userId: string;
  email: string;
  status: 'pending' | 'resolved';
  emailStatus?: 'pending' | 'sent' | 'failed' | 'reset_done' | 'unknown';
  emailSentAt?: string | null;
  createdAt: string;
  resetLink?: string;
  expiresAt?: string;
}

// Dynamic role badge - uses color from /api/roles
const RoleBadge: React.FC<{ roleName: string; roles: RoleInfo[] }> = ({ roleName, roles }) => {
  const role = roles.find(r => r.name === roleName);
  const color = role?.color || '#6b7280';
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border"
      style={{ backgroundColor: color + '18', color, borderColor: color + '44' }}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {roleName}
    </span>
  );
};

const getInitials = (name?: string) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const AvatarView: React.FC<{ name: string; avatar?: string }> = ({ name, avatar }) => {
  if (avatar) {
    return <img src={avatar} alt={name} className="w-16 h-16 rounded-full ring-2 ring-orange-200 object-cover" />;
  }
  return (
    <div className="w-16 h-16 rounded-full ring-2 ring-orange-200 bg-gradient-to-br from-orange-100 to-red-100 text-orange-700 flex items-center justify-center font-black text-xl">
      {getInitials(name)}
    </div>
  );
};

// ----- User Form Modal -----
const UserFormModal: React.FC<{
  user: User | null;
  roles: RoleInfo[];
  departments: string[];
  deptObjs: { id: string; name: string }[];
  onClose: () => void;
  onSave: (u: User) => Promise<void>;
}> = ({ user, roles, departments, deptObjs, onClose, onSave }) => {
  const isEdit = !!user;
  // Default role: first available or 'Employee'
  const defaultRole = roles[0]?.name || 'Employee';
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: (user?.role || defaultRole) as string,
    department: user?.department || '',
    avatar: user?.avatar || '',
  });
  const [scopes, setScopes] = useState<string[]>(user?.managedDepartments || []);
  const [assignments, setAssignments] = useState<NonNullable<User['assignments']>>([]);
  useEffect(() => {
    let cancelled = false;
    setAssignments([]);
    if (user?.id) {
      apiFetch(`/api/users/${user.id}/assignments`)
        .then(r => r.ok ? r.json() : [])
        .then(rows => { if (!cancelled) setAssignments(Array.isArray(rows) ? rows : []); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [user?.id]);
  const selectedLevel = roles.find(r => r.name === form.role)?.managementLevel ?? 10;
  const showScopes = selectedLevel >= 30;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handle = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleAvatarFile = (file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handle('avatar', String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim()) {
      setError('Tên và email không được để trống.');
      return;
    }
    setSaving(true);
    try {
      const saved: User = {
        id: user?.id || Math.random().toString(36).substring(2, 10),
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password.trim() || undefined,
        role: form.role as UserRole,
        department: form.department,
        avatar: form.avatar || '',
        managedDepartments: showScopes ? scopes : user?.managedDepartments || [],
      };
      await onSave(saved);
      onClose();
    } catch {
      setError('Lưu thất bại. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-800 to-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <UserIcon size={16} className="text-white" />
            </div>
            <h3 className="text-white font-bold">{isEdit ? 'Chỉnh sửa người dùng' : 'Thêm người dùng mới'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              <AlertCircle size={16} />{error}
            </div>
          )}

          {/* Avatar preview */}
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
            <AvatarView name={form.name || form.email || 'User'} avatar={form.avatar} />
            <div className="flex-1 space-y-2 text-sm text-gray-500">
              <div>Avatar sẽ tự hiển thị theo chữ cái đầu của tên nếu để trống.</div>
              {isEdit && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => handleAvatarFile(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-orange-200 text-orange-600 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors"
                  >
                    <ImagePlus size={14} /> Chọn ảnh từ máy
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Họ tên <span className="text-red-500">*</span></label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  type="text" required value={form.name}
                  onChange={e => handle('name', e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-300 outline-none text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  type="email" required value={form.email}
                  onChange={e => handle('email', e.target.value)}
                  placeholder="email@company.com"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-300 outline-none text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Mật khẩu {!isEdit && <span className="text-red-500">*</span>}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 text-gray-400" size={16} />
                <input
                  type="password"
                  required={!isEdit}
                  value={form.password}
                  onChange={e => handle('password', e.target.value)}
                  placeholder={isEdit ? 'Để trống nếu không đổi mật khẩu' : 'Nhập mật khẩu đăng nhập'}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-300 outline-none text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Vai trò</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  <select value={form.role} onChange={e => handle('role', e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-300 outline-none bg-white text-sm appearance-none">
                    {roles.length > 0
                      ? roles.map(r => <option key={r.id} value={r.name}>{r.name} (LV {r.managementLevel ?? 10})</option>)
                      : <option value={form.role}>{form.role}</option>
                    }
                  </select>
                  <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
                </div>
                <p className="text-xs text-gray-400 mt-1">Cấp gán theo vai trò: <strong className="text-gray-600">{levelLabel(selectedLevel)} ({selectedLevel})</strong> — tự sync khi lưu.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Phòng ban</label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  <select value={form.department} onChange={e => handle('department', e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-300 outline-none bg-white text-sm appearance-none">
              <option value="">-- Chưa chọn phòng ban --</option>
              {user?.department && !departments.includes(user.department) && (
                <option value={user.department}>{user.department}</option>
              )}
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
                </div>
              </div>
            </div>

            {/* Managed scopes — chỉ cấp Phó GĐ trở lên */}
            {showScopes && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Phòng ban được giao quản lý</label>
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
                  {deptObjs.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">Chưa có phòng ban nào.</p>}
                  {deptObjs.map(d => {
                    const checked = scopes.includes(d.id);
                    return (
                      <label key={d.id} className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${checked ? 'bg-blue-50/50' : ''}`}>
                        <input type="checkbox" checked={checked}
                          onChange={() => setScopes(s => checked ? s.filter(x => x !== d.id) : [...s, d.id])}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                        <span className={checked ? 'text-gray-800 font-medium' : 'text-gray-500'}>{d.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1">Đã chọn {scopes.length} phòng — áp dụng khi đăng nhập lại (token revoke).</p>
              </div>
            )}

            {/* Phân công kiêm nhiệm (từ import nhân sự, chỉ xem) */}
            {isEdit && assignments.length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Phân công kiêm nhiệm ({assignments.length})</label>
                <ul className="border border-gray-200 rounded-xl divide-y divide-gray-50 max-h-36 overflow-y-auto">
                  {assignments.map(a => (
                    <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${a.isPrimary ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {a.isPrimary ? 'CHÍNH' : 'KIÊM NHIỆM'}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-gray-800 font-medium truncate">{a.title}</span>
                        <span className="block text-xs text-gray-400 truncate">{a.departmentName || a.departmentId}{a.confirmationStatus ? ` · ${a.confirmationStatus}` : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-400 mt-1">Do script import nhân sự quản lý, không sửa tay ở đây.</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
              Hủy
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-sm font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl shadow-md shadow-orange-200 hover:shadow-orange-300 transition-all disabled:opacity-60 flex items-center gap-2">
              {saving ? <><RefreshCw size={14} className="animate-spin" /> Đang lưu...</> : <><CheckCircle size={14} />{isEdit ? 'Lưu thay đổi' : 'Thêm người dùng'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ----- Reset Password Dialog -----
const ResetPasswordModal: React.FC<{
  user: User;
  onCancel: () => void;
  onConfirm: () => Promise<{ emailSent?: boolean; message?: string }>;
}> = ({ user, onCancel, onConfirm }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ emailSent?: boolean; message?: string } | null>(null);

  const submit = async () => {
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const response = await onConfirm();
      setResult(response);
    } catch {
      setError('Tạo link đặt lại mật khẩu thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
            <KeyRound size={18} className="text-orange-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-800">Đặt lại mật khẩu</h3>
            <p className="text-xs text-gray-500">{user.name} · {user.email}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="text-sm text-gray-600 bg-orange-50 border border-orange-100 rounded-xl px-3 py-3">
            Hệ thống sẽ tạo link đặt lại mật khẩu một lần và gửi đến email của người dùng. Mật khẩu mới không được hiển thị trong trang quản trị.
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
          {result && (
            <div className={`text-sm rounded-xl px-3 py-3 border ${result.emailSent ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
              <div className="font-semibold">{result.emailSent ? 'Đã gửi link đặt lại mật khẩu cho người dùng.' : 'Đã tạo link nhưng gửi mail chưa thành công.'}</div>
              {result.message && <div className="mt-2 text-xs opacity-80">{result.message}</div>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
            Hủy
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-bold bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Đang tạo link...' : 'Gửi link đặt lại'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ----- Main User Management Page -----
export default function AdminUserManagement() {
  const [users, setUsers]  = useState<User[]>([]);
  const [roles, setRoles]  = useState<RoleInfo[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [deptObjs, setDeptObjs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetRequests, setResetRequests] = useState<PasswordResetRequest[]>([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [editingUser, setEditingUser] = useState<User | null | undefined>(undefined);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [toast, setToast] = useState<AdminToastData | null>(null);
  const [showResetRequests, setShowResetRequests] = useState(false);

  const showToast = (title: string, msg?: string, type: AdminToastData['type'] = 'success') => {
    setToast({ title, msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ur, rr, dr, pr] = await Promise.all([
        apiFetch('/api/users'), apiFetch('/api/roles'), apiFetch('/api/departments'), apiFetch('/api/admin/password-reset-requests')
      ]);
      if (!ur.ok) throw new Error('Không thể tải người dùng');
      setUsers(await ur.json());
      if (rr.ok) setRoles(await rr.json());
      if (dr.ok) {
        const depts = await dr.json();
        setDepartments(depts.map((d: any) => d.name));
        setDeptObjs(depts.map((d: any) => ({ id: d.id, name: d.name })));
      }
      if (pr.ok) {
        const requests = await pr.json();
        setResetRequests(requests);
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSave = async (u: User) => {
    const isNew = !users.find(x => x.id === u.id);
    const res = await apiFetch(isNew ? '/api/users' : `/api/users/${u.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(u),
    });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Lỗi lưu'); }
    // Sync phòng ban được giao cho cấp Phó GĐ+ (backend revoke token để login sau nhận scope)
    const level = roles.find(r => r.name === u.role)?.managementLevel ?? 10;
    if (level >= 30) {
      const sr = await apiFetch(`/api/users/${u.id}/scopes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentIds: u.managedDepartments || [] }),
      });
      if (!sr.ok) { const data = await sr.json().catch(() => ({})); throw new Error(data.error || 'Lưu scope thất bại'); }
    }
    showToast(
      isNew ? `Đã thêm ${u.name}` : `Đã cập nhật ${u.name}`,
      isNew ? `Tài khoản ${u.email} đã sẵn sàng sử dụng.` : `Thông tin và phân quyền đã được làm mới.`,
    );
    await fetchUsers();
  };

  const handleDelete = async (u: User) => {
    const res = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); showToast('Xóa thất bại', data.error || `Không thể xóa tài khoản ${u.name}.`, 'error'); return; }
    showToast(`Đã xóa ${u.name}`, `Tài khoản ${u.email} đã gỡ khỏi hệ thống.`);
    setDeletingUser(null);
    await fetchUsers();
  };

  const handleLockToggle = async (u: User, isLocked: boolean) => {
    const action = isLocked ? 'unlock' : 'lock';
    const res = await apiFetch(`/api/users/${u.id}/${action}`, { method: 'PUT' });
    if (!res.ok) { showToast(isLocked ? 'Mở khóa thất bại' : 'Khóa thất bại', `Không thể ${isLocked ? 'mở khóa' : 'khóa'} tài khoản ${u.name}.`, 'error'); return; }
    showToast(isLocked ? `Đã mở khóa ${u.name}` : `Đã khóa ${u.name}`, isLocked ? 'Tài khoản có thể đăng nhập trở lại.' : 'Tài khoản tạm dừng đăng nhập ngay lập tức.');
    await fetchUsers();
  };

  const handleResetPassword = async (u: User) => {
    const res = await apiFetch(`/api/users/${u.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('Đặt lại mật khẩu thất bại', data.error || `Không thể tạo link cho ${u.name}.`, 'error');
      throw new Error('Reset failed');
    }
    showToast(
      `Đã gửi link cho ${u.name}`,
      data.emailSent ? 'Người dùng đã được thông báo qua email.' : 'Đã tạo link nhưng gửi mail chưa thành công — kiểm tra lại SMTP.',
      data.emailSent ? 'success' : 'error'
    );
    await fetchUsers();
    return {
      emailSent: data.emailSent,
      message: data.emailSent ? 'Người dùng đã được thông báo qua email.' : 'Anh vui lòng kiểm tra lại cấu hình SMTP rồi gửi lại link đặt mật khẩu.',
    };
  };

  const filtered = users.filter(u => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q);
    const matchRole = !filterRole || u.role === filterRole;
    // Khớp cả cột department string cũ lẫn primaryDepartmentId FK mới
    const deptId = deptObjs.find(d => d.name === filterDept)?.id;
    const matchDept = !filterDept || u.department === filterDept || (deptId != null && u.primaryDepartmentId === deptId);
    return matchSearch && matchRole && matchDept;
  });
  const hasFilter = search !== '' || filterRole !== '' || filterDept !== '';

  const pendingResetRequests = resetRequests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-6 pb-8">
      <AdminToastBar toast={toast} onClose={() => setToast(null)} />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg shadow-blue-200">
            <Users size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quản lý Người dùng</h1>
            <p className="text-sm text-gray-400 mt-0.5">Tổng cộng <strong className="text-gray-700">{users.length}</strong> tài khoản</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchUsers}
            className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 transition-all shadow-sm">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setEditingUser(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-orange-200 hover:shadow-orange-300 transition-all">
            <PlusCircle size={16} /> Thêm người dùng
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Yêu cầu quên mật khẩu</h2>
            <p className="text-sm text-gray-400">Chỉ hiển thị các request đang chờ xử lý</p>
          </div>
          <div className="px-3 py-1.5 rounded-full bg-orange-50 text-orange-600 text-sm font-bold">
            {pendingResetRequests.length} đang chờ
          </div>
        </div>

        {pendingResetRequests.length === 0 ? (
          <div className="px-5 py-8 text-sm text-gray-400">Hiện chưa có yêu cầu quên mật khẩu nào đang chờ xử lý.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {pendingResetRequests.map((request) => {
              const matchedUser = users.find(u => u.id === request.userId);
              const remainingMs = request.expiresAt ? new Date(request.expiresAt).getTime() - Date.now() : 0;
              const minutesLeft = Math.max(0, Math.ceil(remainingMs / 60000));
              return (
                <div key={request.id} className="px-5 py-4 space-y-3 hover:bg-gray-50/70">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate">{request.email}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <span>{new Date(request.createdAt).toLocaleString('vi-VN')}</span>
                        {matchedUser && <span>{matchedUser.name}</span>}
                        {request.expiresAt && <span className="text-amber-600 font-medium">Hết hạn sau {minutesLeft} phút</span>}
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${request.emailStatus === 'sent' ? 'bg-emerald-50 text-emerald-700' : request.emailStatus === 'failed' ? 'bg-red-50 text-red-600' : request.emailStatus === 'reset_done' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {request.emailStatus === 'sent' ? 'Mail đã gửi' : request.emailStatus === 'failed' ? 'Mail lỗi' : request.emailStatus === 'reset_done' ? 'Đã đổi mật khẩu' : 'Đang chờ mail'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => matchedUser && setResettingUser(matchedUser)}
                        disabled={!matchedUser}
                        className="px-4 py-2 text-sm font-bold bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-colors disabled:opacity-50"
                      >
                        Cấp lại mật khẩu
                      </button>
                      <button
                        onClick={async () => {
                          const res = await apiFetch(`/api/admin/password-reset-requests/${request.id}`, { method: 'DELETE' });
                          if (!res.ok) { showToast('Xóa request thất bại', 'Không thể xóa yêu cầu này, thử lại sau.', 'error'); return; }
                          showToast('Đã xóa yêu cầu', `Yêu cầu của ${request.email} đã được gỡ.`);
                          await fetchUsers();
                        }}
                        className="px-4 py-2 text-sm font-bold bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <input
            type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm theo tên, email, phòng ban..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-200 outline-none text-sm shadow-sm"
          />
        </div>
        <div className="relative">
          <Shield className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="pl-10 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-orange-200 outline-none shadow-sm appearance-none">
            <option value="">Tất cả vai trò</option>
            {roles.length > 0
              ? roles.map(r => <option key={r.id} value={r.name}>{r.name} (LV {r.managementLevel ?? 10})</option>)
              : ['Admin','Director','Deputy Director','Manager','Employee'].map(r => <option key={r} value={r}>{r}</option>)
            }
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
        <div className="relative">
          <Briefcase className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
            className="pl-10 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-orange-200 outline-none shadow-sm appearance-none max-w-[220px]">
            <option value="">Tất cả phòng ban</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
        {hasFilter && (
          <button onClick={() => { setSearch(''); setFilterRole(''); setFilterDept(''); }}
            className="px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 shadow-sm whitespace-nowrap">
            Xóa lọc ({filtered.length})
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải danh sách người dùng...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-24 gap-3 text-red-500">
          <AlertCircle size={40} strokeWidth={1.5} />
          <p className="font-semibold">{error}</p>
          <button onClick={fetchUsers} className="px-4 py-2 bg-red-50 rounded-xl text-sm font-medium hover:bg-red-100 flex items-center gap-2">
            <RefreshCw size={14} />Thử lại
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-30" strokeWidth={1.5} />
              <p className="font-medium">Không tìm thấy người dùng phù hợp</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3.5 px-5 text-xs font-bold text-gray-500 uppercase tracking-wider">Người dùng</th>
                    <th className="text-left py-3.5 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="text-left py-3.5 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Chức vụ</th>
                    <th className="text-left py-3.5 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Cấp</th>
                    <th className="text-left py-3.5 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Phòng ban</th>
                    <th className="text-right py-3.5 px-5 text-xs font-bold text-gray-500 uppercase tracking-wider">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50/70 transition-colors group">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3">
                          {u.avatar ? (
                            <img src={u.avatar} alt={u.name}
                              className="w-9 h-9 rounded-full ring-1 ring-gray-200 object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-100 to-red-100 text-orange-700 flex items-center justify-center font-bold text-xs ring-1 ring-orange-200 flex-shrink-0">
                              {getInitials(u.name)}
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-800 flex items-center gap-2">
                              {u.name}
                              {u.isLocked && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600">BỊ KHÓA</span>}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-gray-500">{u.email}</td>
                      <td className="py-3.5 px-4">
                        <RoleBadge roleName={u.role} roles={roles} />
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200" title={levelLabel(u.managementLevel)}>
                          LV {u.managementLevel ?? 10}
                        </span>
                        {(u.managedDepartments?.length || 0) > 0 && (
                          <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200" title="Phòng ban được giao quản lý">
                            +{u.managedDepartments!.length} phòng
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-gray-500">{u.department}</td>
                      <td className="py-3.5 px-5">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingUser(u)}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Chỉnh sửa">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleLockToggle(u, !!u.isLocked)}
                            className={`p-1.5 rounded-lg transition-colors ${u.isLocked ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100'}`} 
                            title={u.isLocked ? "Mở khóa tài khoản" : "Khóa tài khoản"}>
                            {u.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
                          </button>
                          <button onClick={() => setResettingUser(u)}
                            className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg transition-colors" title="Đặt lại mật khẩu">
                            <KeyRound size={14} />
                          </button>
                          <button onClick={() => setDeletingUser(u)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Xóa">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {editingUser !== undefined && (
        <UserFormModal
          user={editingUser}
          roles={roles}
          departments={departments}
          deptObjs={deptObjs}
          onClose={() => setEditingUser(undefined)}
          onSave={handleSave}
        />
      )}
      {resettingUser && (
        <ResetPasswordModal
          user={resettingUser}
          onCancel={() => setResettingUser(null)}
          onConfirm={() => handleResetPassword(resettingUser)}
        />
      )}
      {deletingUser && (
        <AdminDeleteModal
          title="Xóa người dùng?"
          itemName={deletingUser.name}
          itemSub={`${deletingUser.email} · ${deletingUser.role}`}
          warning="Công việc, báo cáo và lịch sử của tài khoản này vẫn giữ lại nhưng mất người phụ trách."
          busy={false}
          onCancel={() => setDeletingUser(null)}
          onConfirm={() => handleDelete(deletingUser)}
        />
      )}
    </div>
  );
}
