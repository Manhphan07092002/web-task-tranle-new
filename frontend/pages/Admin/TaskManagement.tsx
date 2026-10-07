import { apiFetch } from '../../services/api';
import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare, Search, RefreshCw, AlertCircle, Filter, PlusCircle,
  Trash2, CheckCircle, Clock, Flame, Circle, Edit2,
  ChevronDown, Calendar, Building2, X, Save
} from 'lucide-react';
import Flatpickr from 'react-flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { toLocalDateString } from '../../utils/dateUtils';
import { Task, TaskStatus, TaskPriority, User } from '../../types';

const PRIORITY_STYLE: Record<string, string> = {
  High: 'bg-red-100 text-red-700 border-red-200',
  Medium: 'bg-orange-100 text-orange-700 border-orange-200',
  Low: 'bg-green-100 text-green-700 border-green-200',
};
const STATUS_STYLE: Record<string, string> = {
  'Done': 'bg-emerald-100 text-emerald-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Todo': 'bg-gray-100 text-gray-600',
};
const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'Done') return <CheckCircle size={12} className="text-emerald-500" />;
  if (status === 'In Progress') return <Clock size={12} className="text-blue-500" />;
  return <Circle size={12} className="text-gray-400" />;
};

type TaskForm = {
  title: string; description: string; department: string;
  priority: string; status: string; startDate: string; dueDate: string; createdBy: string;
};

const EMPTY_FORM: TaskForm = {
  title: '', description: '', department: '',
  priority: 'Medium', status: 'Todo',
  startDate: new Date().toISOString().split('T')[0],
  dueDate: '', createdBy: ''
};

const TaskFormModal: React.FC<{
  task: Task | null; users: User[]; departments: string[]; onClose: () => void; onSave: (t: Task) => Promise<void>;
}> = ({ task, users, departments, onClose, onSave }) => {
  const isEdit = !!task;
  const [form, setForm] = useState<TaskForm>(task ? {
    title: task.title, description: task.description || '',
    department: task.department || departments[0] || '', priority: task.priority,
    status: task.status, startDate: task.startDate || '',
    dueDate: task.dueDate || '', createdBy: task.createdBy || ''
  } : { ...EMPTY_FORM, department: departments[0] || '', createdBy: users[0]?.id || '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: keyof TaskForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setErr('Tiêu đề không được trống.'); return; }
    setSaving(true); setErr('');
    try {
      const saved: Task = {
        id: task?.id || Math.random().toString(36).substring(2, 10),
        title: form.title.trim(), description: form.description,
        department: form.department, priority: form.priority as TaskPriority,
        status: form.status as TaskStatus, startDate: form.startDate,
        dueDate: form.dueDate || undefined, createdBy: form.createdBy,
        assignees: task?.assignees || [], tags: task?.tags || [],
        subtasks: task?.subtasks || [], comments: task?.comments || [],
        recurrence: task?.recurrence,
      };
      await onSave(saved);
      onClose();
    } catch { setErr('Lưu thất bại, vui lòng thử lại.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-purple-700 to-purple-500 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CheckSquare size={18} className="text-white" />
            <h3 className="text-white font-bold">{isEdit ? 'Chỉnh sửa công việc' : 'Tạo công việc mới'}</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={15} />{err}</div>}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tiêu đề <span className="text-red-500">*</span></label>
            <input required value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="Tên công việc..."
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-300 outline-none text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mô tả</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
              placeholder="Chi tiết công việc..."
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-300 outline-none text-sm resize-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Trạng thái</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-purple-300 outline-none">
                <option value="Todo">Todo</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Ưu tiên</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-purple-300 outline-none">
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Phòng ban</label>
              <select value={form.department} onChange={e => set('department', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-purple-300 outline-none">
                <option value="">-- Chưa chọn phòng ban --</option>
                {task?.department && !departments.includes(task.department) && (
                  <option value={task.department}>{task.department}</option>
                )}
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Ngày bắt đầu</label>
              <Flatpickr
                value={form.startDate ? new Date(form.startDate) : ''}
                onChange={([date]) => set('startDate', date ? toLocalDateString(date) : '')}
                options={{ dateFormat: 'd/m/Y' }}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Hạn chót</label>
              <Flatpickr
                value={form.dueDate ? new Date(form.dueDate) : ''}
                onChange={([date]) => set('dueDate', date ? toLocalDateString(date) : '')}
                options={{ dateFormat: 'd/m/Y' }}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-300 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Người tạo / Chịu trách nhiệm</label>
            <select value={form.createdBy} onChange={e => set('createdBy', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-purple-300 outline-none">
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role} - {u.department})</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-purple-300 transition-all disabled:opacity-60 flex items-center gap-2">
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang lưu...</> : <><Save size={14} />{isEdit ? 'Lưu thay đổi' : 'Tạo công việc'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default function AdminTaskManagement() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3200);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tr, ur, dr] = await Promise.all([
        apiFetch('/api/tasks'), apiFetch('/api/users'), apiFetch('/api/departments')
      ]);
      setTasks(await tr.json()); setUsers(await ur.json());
      if (dr.ok) {
        const rows = await dr.json();
        setDepartments(rows.map((d: { name: string }) => d.name).filter(Boolean));
      }
    } catch { setError('Không thể tải dữ liệu'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSave = async (t: Task) => {
    const isNew = !tasks.find(x => x.id === t.id);
    const res = await apiFetch(isNew ? '/api/tasks' : `/api/tasks/${t.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    if (!res.ok) throw new Error('Lỗi');
    showToast(isNew ? `Đã tạo: ${t.title}` : `Đã cập nhật: ${t.title}`);
    await fetchAll();
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Xóa công việc "${title}"?`)) return;
    setDeletingId(id);
    try {
      await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      showToast(`Đã xóa: ${title}`);
      await fetchAll();
    } catch { showToast('Xóa thất bại', 'error'); }
    finally { setDeletingId(null); }
  };

  const getUserName = (id: string) => users.find(u => u.id === id)?.name || id;
  const getUserAvatar = (id: string) => users.find(u => u.id === id)?.avatar;
  const filtered = tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.department?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterDept && t.department !== filterDept) return false;
    return true;
  });

  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.status === TaskStatus.DONE).length,
    inProgress: tasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length,
    high: tasks.filter(t => t.priority === TaskPriority.HIGH && t.status !== TaskStatus.DONE).length,
  };

  return (
    <div className="space-y-6 pb-8">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-medium
          ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl shadow-lg shadow-purple-200">
            <CheckSquare size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quản lý Công việc</h1>
            <p className="text-sm text-gray-400 mt-0.5">Toàn bộ <strong className="text-gray-700">{tasks.length}</strong> công việc trong hệ thống</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm"><RefreshCw size={16} /></button>
          <button onClick={() => setEditingTask(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-200 hover:shadow-purple-300 transition-all">
            <PlusCircle size={16} /> Tạo công việc
          </button>
        </div>
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Tổng cộng', value: stats.total, color: 'bg-purple-50 text-purple-700', icon: CheckSquare },
          { label: 'Hoàn thành', value: stats.done, color: 'bg-emerald-50 text-emerald-700', icon: CheckCircle },
          { label: 'Đang làm', value: stats.inProgress, color: 'bg-blue-50 text-blue-700', icon: Clock },
          { label: 'Ưu tiên cao', value: stats.high, color: 'bg-red-50 text-red-700', icon: Flame },
        ].map(s => (
          <div key={s.label} className={`${s.color} rounded-xl p-4 flex items-center gap-3`}>
            <s.icon size={20} /><div><p className="text-2xl font-black">{s.value}</p><p className="text-xs opacity-70">{s.label}</p></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={15} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Tìm công việc, phòng ban..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-purple-200 outline-none text-sm shadow-sm" />
        </div>
        {[
          { value: filterStatus, set: setFilterStatus, opts: [['', 'Tất cả trạng thái'], ['Todo', 'Todo'], ['In Progress', 'Đang làm'], ['Done', 'Hoàn thành']] },
          { value: filterPriority, set: setFilterPriority, opts: [['', 'Tất cả ưu tiên'], ['High', 'Cao'], ['Medium', 'Trung bình'], ['Low', 'Thấp']] },
          { value: filterDept, set: setFilterDept, opts: [['', 'Tất cả phòng ban'], ...departments.map(d => [d, d])] },
        ].map((f, i) => (
          <div key={i} className="relative">
            <Filter className="absolute left-3 top-3 text-gray-400 pointer-events-none" size={14} />
            <select value={f.value} onChange={e => f.set(e.target.value)}
              className="pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-purple-200 outline-none shadow-sm appearance-none">
              {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={13} />
          </div>
        ))}
        {(filterStatus || filterPriority || filterDept || search) && (
          <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterPriority(''); setFilterDept(''); }}
            className="px-3 py-2.5 text-xs text-purple-600 border border-purple-200 rounded-xl hover:bg-purple-50">Xóa bộ lọc</button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex flex-col items-center py-24 gap-3">
          <div className="w-10 h-10 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-24 gap-3 text-red-500">
          <AlertCircle size={40} strokeWidth={1.5} /><p>{error}</p>
          <button onClick={fetchAll} className="px-4 py-2 bg-red-50 rounded-xl text-sm flex items-center gap-2"><RefreshCw size={14} />Thử lại</button>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-600">
              {filtered.length !== tasks.length ? `${filtered.length} / ${tasks.length} kết quả` : `${tasks.length} công việc`}
            </span>
          </div>
          {filtered.length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <CheckSquare size={40} className="mx-auto mb-3 opacity-30" strokeWidth={1.5} />
              <p>Không tìm thấy công việc</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wider">Công việc</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">Phòng ban</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Trạng thái</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Ưu tiên</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Người tạo</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden xl:table-cell">Ngày bắt đầu</th>
                    <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wider">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(task => (
                    <tr key={task.id} className="hover:bg-gray-50/70 transition-colors group">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={task.status} />
                          <div>
                            <p className={`font-semibold ${task.status === TaskStatus.DONE ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.title}</p>
                            {task.tags && task.tags.length > 0 && (
                              <div className="flex gap-1 mt-0.5">
                                {task.tags.slice(0, 2).map(tag => (
                                  <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 hidden md:table-cell">
                        <span className="flex items-center gap-1.5 text-gray-500 text-xs"><Building2 size={12} />{task.department || '-'}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLE[task.status] || 'bg-gray-100 text-gray-600'}`}>{task.status}</span>
                      </td>
                      <td className="py-3.5 px-4 hidden lg:table-cell">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${PRIORITY_STYLE[task.priority] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{task.priority}</span>
                      </td>
                      <td className="py-3.5 px-4 hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          {getUserAvatar(task.createdBy) && <img src={getUserAvatar(task.createdBy)} alt="" className="w-6 h-6 rounded-full object-cover" />}
                          <span className="text-gray-500 text-xs truncate max-w-[100px]">{getUserName(task.createdBy)}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 hidden xl:table-cell text-gray-500 text-xs">
                        <span className="flex items-center gap-1"><Calendar size={11} />{task.startDate}</span>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingTask(task)}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Chỉnh sửa">
                            <Edit2 size={13} />
                          </button>
                          <button disabled={deletingId === task.id} onClick={() => handleDelete(task.id, task.title)}
                            className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all disabled:opacity-50" title="Xóa">
                            {deletingId === task.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
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

      {/* Modal */}
      {editingTask !== undefined && (
        <TaskFormModal task={editingTask} users={users} departments={departments} onClose={() => setEditingTask(undefined)} onSave={handleSave} />
      )}
    </div>
  );
}
