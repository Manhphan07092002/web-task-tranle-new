import { apiFetch } from '../../services/api';
import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign, Search, RefreshCw, AlertCircle, CheckCircle, Clock,
  XCircle, FileEdit, Trash2, ChevronDown, Filter, Eye,
  ThumbsUp, ThumbsDown, MessageSquare, Building2, X, ShieldCheck, Download
} from 'lucide-react';
import { User } from '../../types';
import { RevenueReport } from '../../services/revenueService';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { exportXlsx } from '../../utils/exportXlsx';

const fmtMoney = (v: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v);

const STATUS_META: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  Draft: { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: 'Nháp', icon: <FileEdit size={11} /> },
  'Pending Manager': { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Chờ TP duyệt', icon: <Clock size={11} /> },
  'Pending Director': { cls: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Chờ GĐ duyệt', icon: <Clock size={11} /> },
  Approved: { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Đã duyệt', icon: <CheckCircle size={11} /> },
  Rejected: { cls: 'bg-red-100 text-red-600 border-red-200', label: 'Từ chối', icon: <XCircle size={11} /> },
};

const RejectModal: React.FC<{
  report: RevenueReport; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}> = ({ report, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center"><ThumbsDown size={15} className="text-red-500" /></div>
            <h3 className="font-bold text-gray-800">Từ chối báo cáo</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600">Báo cáo: <strong>{report.title}</strong></p>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Lý do từ chối <span className="text-red-500">*</span></label>
          <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Nhập lý do từ chối để thông báo cho người gửi..."
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-200 outline-none text-sm resize-none" />
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
          <button disabled={!reason.trim() || saving}
            onClick={async () => { setSaving(true); await onConfirm(reason); setSaving(false); }}
            className="px-5 py-2 bg-red-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center gap-2 hover:bg-red-600 transition-colors">
            {saving ? <><RefreshCw size={14} className="animate-spin" />Đang xử lý...</> : <><ThumbsDown size={14} />Từ chối</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function AdminRevenueManagement() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<RevenueReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailReport, setDetailReport] = useState<RevenueReport | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RevenueReport | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3200);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rr, ur] = await Promise.all([apiFetch('/api/revenue-reports'), apiFetch('/api/users')]);
      const list: RevenueReport[] = await rr.json();
      setReports(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setUsers(await ur.json());
    } catch { setError('Không thể tải dữ liệu'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const patchReport = async (r: RevenueReport, patch: Partial<RevenueReport>) => {
    const updated = { ...r, ...patch };
    const res = await apiFetch(`/api/revenue-reports/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated),
    });
    if (!res.ok) throw new Error('Lỗi cập nhật');
    return updated as RevenueReport;
  };

  const handleApprove = async (r: RevenueReport) => {
    try {
      const nextStatus = r.status === 'Pending Manager' ? 'Pending Director' : 'Approved';
      const payload: any = { status: nextStatus };
      if (nextStatus === 'Approved') payload.approvedAt = new Date().toISOString();
      
      const updated = await patchReport(r, payload);
      showToast(nextStatus === 'Approved' ? 'Đã phê duyệt báo cáo doanh thu!' : 'Đã duyệt và chuyển cho Giám đốc!');
      await fetchAll();
      if (detailReport?.id === r.id) setDetailReport(updated);
    } catch { showToast('Lỗi phê duyệt', 'error'); }
  };

  const handleReject = async (r: RevenueReport, reason: string) => {
    try {
      const updated = await patchReport(r, { status: 'Rejected', directorFeedback: reason });
      showToast('Đã từ chối báo cáo');
      setRejectTarget(null);
      await fetchAll();
      if (detailReport?.id === r.id) setDetailReport(updated);
    } catch { showToast('Lỗi xử lý', 'error'); }
  };

  const handleSetPending = async (r: RevenueReport) => {
    try {
      const updated = await patchReport(r, { status: 'Pending Director' });
      showToast('Đã chuyển về Chờ duyệt');
      await fetchAll();
      if (detailReport?.id === r.id) setDetailReport(updated);
    } catch { showToast('Lỗi', 'error'); }
  };

  const handleDelete = async (r: RevenueReport) => {
    if (!confirm(`Xóa báo cáo doanh thu "${r.title}"?`)) return;
    setDeletingId(r.id);
    try {
      await apiFetch(`/api/revenue-reports/${r.id}`, { method: 'DELETE' });
      showToast(`Đã xóa: ${r.title}`);
      if (detailReport?.id === r.id) setDetailReport(null);
      await fetchAll();
    } catch { showToast('Xóa thất bại', 'error'); }
    finally { setDeletingId(null); }
  };

  const getUser = (id?: string) => users.find(u => u.id === id);
  const departments = [...new Set(reports.map(r => r.department).filter(Boolean))].sort();

  const filtered = reports.filter(r => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) && !r.department?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterDept && r.department !== filterDept) return false;
    return true;
  });

  const statusCounts = Object.keys(STATUS_META).reduce((acc, k) => ({ ...acc, [k]: reports.filter(r => r.status === k).length }), {} as Record<string, number>);

  const exportToExcel = () => {
    const data = filtered.map(r => ({
      'Báo cáo': r.title,
      'Phòng ban': r.department || 'Chưa phân phòng',
      'Loại': r.reportType === 'monthly' ? 'Theo tháng' : 'Theo tuần',
      'Trạng thái': STATUS_META[r.status]?.label || r.status,
      'Tổng Doanh thu': r.totalDelivered,
      'Người lập': getUser(r.authorId)?.name || r.authorId,
      'Ngày tạo': new Date(r.createdAt).toLocaleString('vi-VN')
    }));

    void exportXlsx(data, `TranLe_Bao_Cao_Doanh_Thu_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Doanh Thu');
  };

  const chartData = useMemo(() => {
    const dataByMonth: Record<string, number> = {};
    const dataByDept: Record<string, number> = {};
    
    reports.forEach(r => {
      if (r.status !== 'Approved') return;
      const d = new Date(r.createdAt);
      const m = `T${d.getMonth() + 1}`;
      dataByMonth[m] = (dataByMonth[m] || 0) + r.totalDelivered;
      
      const dept = r.department || 'Khác';
      dataByDept[dept] = (dataByDept[dept] || 0) + r.totalDelivered;
    });

    return {
      monthly: Object.entries(dataByMonth).map(([name, value]) => ({ name, value })),
      dept: Object.entries(dataByDept).map(([name, value]) => ({ name, value }))
    };
  }, [reports]);

  const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b'];

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
          <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg shadow-green-200">
            <DollarSign size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quản lý Doanh thu</h1>
            <p className="text-sm text-gray-400 mt-0.5">Tổng cộng <strong className="text-gray-700">{reports.length}</strong> báo cáo doanh thu</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <button onClick={exportToExcel} className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 font-semibold text-sm flex items-center gap-2 transition-colors">
              <Download size={16} /> Xuất Excel
           </button>
           <button onClick={() => navigate('/admin/organization?tab=roles')} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 font-semibold text-sm flex items-center gap-2 transition-colors">
              <ShieldCheck size={16} /> Phân quyền
           </button>
           <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm"><RefreshCw size={16} /></button>
        </div>
      </div>

      {/* Analytics Charts */}
      {reports.some(r => r.status === 'Approved') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-4">Doanh thu theo tháng (Đã duyệt)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.monthly}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <YAxis tickFormatter={(val) => `${val / 1000000}Tr`} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} width={60} />
                  <Tooltip cursor={{ fill: '#f3f4f6' }} formatter={(val: any) => fmtMoney(Number(val))} />
                  <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-4">Tỷ trọng doanh thu theo Phòng</h3>
            <div className="h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData.dept} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                    {chartData.dept.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(val: any) => fmtMoney(Number(val))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 w-1/3 pl-4">
                {chartData.dept.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                    <span className="text-gray-600 truncate">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(STATUS_META).map(([status, s]) => (
          <button key={status} onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
            className={`rounded-xl p-3 flex items-center gap-3 border transition-all cursor-pointer
              ${filterStatus === status ? s.cls + ' ring-2 ring-offset-1 ring-current shadow-md' : s.cls + ' hover:opacity-80'}`}>
            <span className="flex-shrink-0">{s.icon}</span>
            <div className="text-left min-w-0">
              <p className="text-xl font-black leading-none">{statusCounts[status] || 0}</p>
              <p className="text-[10px] opacity-70 mt-0.5 truncate">{s.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={15} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Tìm theo tiêu đề, phòng ban..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-emerald-200 outline-none text-sm shadow-sm" />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-3 text-gray-400 pointer-events-none" size={14} />
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
            className="pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-200 outline-none shadow-sm appearance-none">
            <option value="">Tất cả phòng ban</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={13} />
        </div>
        {(filterStatus || filterDept || search) && (
          <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterDept(''); }}
            className="px-3 py-2.5 text-xs text-emerald-600 border border-emerald-200 rounded-xl hover:bg-emerald-50">Xóa bộ lọc</button>
        )}
      </div>

      {/* Table + Detail */}
      <div className={`flex gap-5 ${detailReport ? 'flex-col xl:flex-row' : ''}`}>
        <div className={`bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden ${detailReport ? 'xl:flex-1' : 'flex-1'}`}>
          {loading ? (
            <div className="flex flex-col items-center py-24 gap-3">
              <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">Đang tải...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-24 gap-3 text-red-500">
              <AlertCircle size={40} strokeWidth={1.5} /><p>{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <DollarSign size={40} className="mx-auto mb-3 opacity-30" strokeWidth={1.5} />
              <p>Không có báo cáo doanh thu nào</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wider">Báo cáo</th>
                    <th className="text-right py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">Lũy kế</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Trạng thái</th>
                    <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Người gửi</th>
                    <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase tracking-wider">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(r => {
                    const author = getUser(r.authorId);
                    const s = STATUS_META[r.status] || { cls: 'bg-gray-100', label: r.status };
                    const isActive = detailReport?.id === r.id;
                    return (
                      <tr key={r.id}
                        className={`transition-colors cursor-pointer group ${isActive ? 'bg-emerald-50' : 'hover:bg-gray-50/70'}`}
                        onClick={() => setDetailReport(isActive ? null : r)}>
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
                              <DollarSign size={16} />
                            </div>
                            <div>
                              <p className="font-semibold text-gray-800 truncate max-w-[220px]">{r.title}</p>
                              <span className="text-xs text-gray-400 flex items-center gap-1"><Building2 size={10} />{r.department}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 hidden md:table-cell text-right">
                          <span className="font-bold text-emerald-600">{fmtMoney(r.totalCumulative || 0)}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${s.cls}`}>
                            {s.icon} {s.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 hidden lg:table-cell">
                          {author && (
                            <div className="flex items-center gap-2">
                              {author.avatar ? (
                                <img src={author.avatar} alt={author.name} className="w-6 h-6 rounded-full object-cover" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-bold">
                                  {author.name?.charAt(0)}
                                </div>
                              )}
                              <div className="flex flex-col">
                                <span className="text-xs text-gray-700 font-medium truncate max-w-[100px]">{author.name}</span>
                                <span className="text-[10px] text-gray-400">{new Date(r.createdAt).toLocaleDateString('vi-VN')}</span>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-5" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {r.status.startsWith('Pending') && (<>
                              <button onClick={() => handleApprove(r)} title="Phê duyệt"
                                className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg"><ThumbsUp size={13} /></button>
                              <button onClick={() => setRejectTarget(r)} title="Từ chối"
                                className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"><ThumbsDown size={13} /></button>
                            </>)}
                            {(r.status === 'Approved' || r.status === 'Rejected') && (
                              <button onClick={() => handleSetPending(r)} title="Đặt lại Chờ duyệt"
                                className="p-1.5 text-yellow-500 hover:bg-yellow-50 rounded-lg"><Clock size={13} /></button>
                            )}
                            <button onClick={() => setDetailReport(isActive ? null : r)} title="Xem chi tiết"
                              className="p-1.5 text-blue-400 hover:bg-blue-50 rounded-lg"><Eye size={13} /></button>
                            <button disabled={deletingId === r.id} onClick={() => handleDelete(r)} title="Xóa"
                              className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg disabled:opacity-50">
                              {deletingId === r.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {detailReport && (() => {
          const author = getUser(detailReport.authorId);
          const approver = getUser(detailReport.approvedBy);
          const s = STATUS_META[detailReport.status] || { cls: 'bg-gray-100', label: detailReport.status };
          
          let rows: any[] = [];
          try { rows = JSON.parse(detailReport.content || '[]'); } catch {}

          return (
            <div className="xl:w-96 bg-white border border-gray-100 rounded-2xl shadow-sm p-6 space-y-4 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800">Chi tiết doanh thu</h3>
                <button onClick={() => setDetailReport(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
              </div>
              <div className="h-px bg-gray-100" />
              <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Tiêu đề</p><p className="font-bold text-gray-800">{detailReport.title}</p></div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Kỳ báo cáo</p><p className="text-sm font-semibold">{detailReport.reportType === 'monthly' ? 'Tháng' : 'Tuần'}</p></div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Trạng thái</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${s.cls}`}>{s.icon} {s.label}</span>
                </div>
              </div>

              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 space-y-2">
                 <div className="flex justify-between items-center">
                    <span className="text-xs text-emerald-800">Tổng doanh thu kỳ:</span>
                    <span className="font-bold text-emerald-700">{fmtMoney(detailReport.totalDelivered || 0)}</span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-xs text-emerald-800">Lũy kế:</span>
                    <span className="font-bold text-emerald-700">{fmtMoney(detailReport.totalCumulative || 0)}</span>
                 </div>
                 <div className="flex justify-between items-center pt-2 border-t border-emerald-200/50">
                    <span className="text-xs font-bold text-emerald-900">Tổng HĐ (sau VAT):</span>
                    <span className="font-black text-emerald-700">{fmtMoney((detailReport.totalPreTax || 0) * 1.1)}</span>
                 </div>
              </div>

              {author && (
                <div><p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Người lập</p>
                  <div className="flex items-center gap-2">
                    {author.avatar ? (
                      <img src={author.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold">
                        {author.name?.charAt(0)}
                      </div>
                    )}
                    <span className="text-sm font-semibold text-gray-700">{author.name}</span>
                  </div>
                </div>
              )}
              
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Chi tiết Hợp đồng ({rows.length})</p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {rows.map((r, i) => (
                    <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs">
                      <div className="font-bold text-gray-700">{r.contractNumber}</div>
                      <div className="text-gray-500 truncate">{r.contractName}</div>
                      <div className="mt-1 text-emerald-600 font-semibold text-right">Doanh thu kỳ: {fmtMoney(r.deliveredMonth)}</div>
                    </div>
                  ))}
                  {rows.length === 0 && <p className="text-xs text-gray-400">Không có dữ liệu hợp đồng.</p>}
                </div>
              </div>

              {detailReport.managerFeedback && (
                 <div>
                   <p className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><MessageSquare size={10} /> Phản hồi Trưởng phòng</p>
                   <div className="bg-amber-50 rounded-xl px-4 py-3 text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{detailReport.managerFeedback}</div>
                 </div>
              )}
              {detailReport.directorFeedback && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><MessageSquare size={10} /> Phản hồi Giám đốc</p>
                  <div className="bg-red-50 rounded-xl px-4 py-3 text-sm text-red-700 leading-relaxed whitespace-pre-wrap">{detailReport.directorFeedback}</div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                {detailReport.status.startsWith('Pending') && (<>
                  <button onClick={() => handleApprove(detailReport)}
                    className="flex-1 py-2 bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-600 transition-colors">
                    <ThumbsUp size={13} />Phê duyệt
                  </button>
                  <button onClick={() => setRejectTarget(detailReport)}
                    className="flex-1 py-2 bg-red-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-red-600 transition-colors">
                    <ThumbsDown size={13} />Từ chối
                  </button>
                </>)}
                {(detailReport.status === 'Approved' || detailReport.status === 'Rejected') && (
                  <button onClick={() => handleSetPending(detailReport)}
                    className="flex-1 py-2 bg-yellow-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-yellow-600 transition-colors min-w-full">
                    <Clock size={13} />Đặt lại chờ duyệt
                  </button>
                )}
                <button onClick={() => handleDelete(detailReport)}
                  className="p-2 bg-gray-100 text-red-400 rounded-xl hover:bg-red-50 hover:text-red-600 transition-colors" title="Xóa">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Reject Modal */}
      {rejectTarget && (
        <RejectModal report={rejectTarget} onClose={() => setRejectTarget(null)}
          onConfirm={reason => handleReject(rejectTarget, reason)} />
      )}
    </div>
  );
}
