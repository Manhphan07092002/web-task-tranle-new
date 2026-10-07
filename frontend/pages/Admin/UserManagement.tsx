import { apiFetch } from '../../services/api';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, PlusCircle, Edit2, Trash2, Shield, Briefcase,
  Search, RefreshCw, AlertCircle, X, Mail, User as UserIcon,
  CheckCircle, ChevronDown, Lock, Unlock, ImagePlus, KeyRound, Copy, ExternalLink, Link as LinkIcon
} from 'lucide-react';
import { User, UserRole } from '../../types';

interface RoleInfo {
  id: string; name: string; color: string; isSystem: number;
}

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
  onClose: () => void;
  onSave: (u: User) => Promise<void>;
}> = ({ user, roles, departments, onClose, onSave }) => {
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
                      ? roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)
                      : <option value={form.role}>{form.role}</option>
                    }
                  </select>
                  <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
                </div>
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

// ----- Confirm Delete Dialog -----
const ConfirmDeleteModal: React.FC<{
  user: User;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}> = ({ user, onCancel, onConfirm }) => {
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 size={28} className="text-red-500" />
        </div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">Xóa người dùng?</h3>
        <p className="text-sm text-gray-500 mb-1">Bạn sắp xóa tài khoản:</p>
        <p className="font-bold text-gray-800 mb-1">{user.name}</p>
        <p className="text-xs text-gray-400 mb-5">{user.email} · {user.role}</p>
        <p className="text-xs text-red-500 mb-5">Hành động này không thể hoàn tác.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Hủy
          </button>
          <button
            onClick={async () => { setDeleting(true); await onConfirm(); setDeleting(false); }}
            disabled={deleting}
            className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {deleting ? <><RefreshCw size={14} className="animate-spin" />Đang xóa...</> : 'Xóa ngay'}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetRequests, setResetRequests] = useState<PasswordResetRequest[]>([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [editingUser, setEditingUser] = useState<User | null | undefined>(undefined);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showResetRequests, setShowResetRequests] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
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
    if (!res.ok) throw new Error('Lỗi lưu');
    showToast(isNew ? `Đã thêm người dùng ${u.name}` : `Đã cập nhật ${u.name}`);
    await fetchUsers();
  };

  const handleDelete = async (u: User) => {
    const res = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Xóa thất bại', 'error'); return; }
    showToast(`Đã xóa ${u.name}`);
    setDeletingUser(null);
    await fetchUsers();
  };

  const handleLockToggle = async (u: User, isLocked: boolean) => {
    const action = isLocked ? 'unlock' : 'lock';
    const res = await apiFetch(`/api/users/${u.id}/${action}`, { method: 'PUT' });
    if (!res.ok) { showToast(isLocked ? 'Mở khóa thất bại' : 'Khóa thất bại', 'error'); return; }
    showToast(isLocked ? `Đã mở khóa tài khoản ${u.name}` : `Đã khóa tài khoản ${u.name}`);
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
      showToast(data.error || 'Đặt lại mật khẩu thất bại', 'error');
      throw new Error('Reset failed');
    }
    showToast(
      data.emailSent
        ? `Đã gửi link đặt lại mật khẩu cho ${u.name}`
        : `Đã tạo link đặt lại mật khẩu cho ${u.name}, nhưng gửi mail chưa thành công`,
      data.emailSent ? 'success' : 'error'
    );
    await fetchUsers();
    return {
      emailSent: data.emailSent,
      message: data.emailSent ? 'Người dùng đã được thông báo qua email.' : 'Anh vui lòng kiểm tra lại cấu hình SMTP rồi gửi lại link đặt mật khẩu.',
    };
  };

  const filtered = users.filter(u => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = !filterRole || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const pendingResetRequests = resetRequests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-6 pb-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-medium transition-all
          ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

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
                          if (!res.ok) { showToast('Xóa request thất bại', 'error'); return; }
                          showToast('Đã xóa request quên mật khẩu');
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
            placeholder="Tìm theo tên, email..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-200 outline-none text-sm shadow-sm"
          />
        </div>
        <div className="relative">
          <Shield className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="pl-10 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-orange-200 outline-none shadow-sm appearance-none">
            <option value="">Tất cả vai trò</option>
            {roles.length > 0
              ? roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)
              : ['Admin','Director','Manager','Employee'].map(r => <option key={r} value={r}>{r}</option>)
            }
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
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
        <ConfirmDeleteModal
          user={deletingUser}
          onCancel={() => setDeletingUser(null)}
          onConfirm={() => handleDelete(deletingUser)}
        />
      )}
    </div>
  );
}
