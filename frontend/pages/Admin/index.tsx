import { apiFetch } from '../../services/api';
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Users, CheckSquare, FileText, Video, Shield, TrendingUp,
  Activity, RefreshCw, AlertCircle, BarChart2, PieChart as PieIcon,
  Clock, UserCheck, XCircle, CheckCircle, Zap, ArrowUpRight,
  Database, Server, Cpu, Mail, List, Send, Key
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.08 } } };

interface AdminStats {
  totalUsers: number;
  totalTasks: number;
  totalReports: number;
  activeMeetings: number;
  totalLogs: number;
  scheduledEmails: number;
  sentEmails: number;
  pendingResets: number;
  roleBreakdown: { role: string; count: number }[];
  taskStatusBreakdown: { status: string; count: number }[];
  taskDeptBreakdown: { department: string; count: number }[];
  reportStatusBreakdown: { status: string; count: number }[];
  systemInfo?: {
    nodeVersion: string;
    platform: string;
    memoryUsage: number;
    uptime: number;
    dbSize: number;
  };
}

interface PasswordResetRequest {
  id: string;
  userId: string;
  email: string;
  status: 'pending' | 'resolved';
  createdAt: string;
}

// Vivid, high-contrast palette for dynamic assignment
const VIVID_PALETTE = [
  '#ef4444', '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#e11d48', '#0ea5e9', '#a855f7', '#84cc16', '#d946ef',
];

const KNOWN_ROLE_COLORS: Record<string, string> = {
  Admin: '#ef4444',
  Director: '#8b5cf6',
  Manager: '#3b82f6',
  Employee: '#22c55e',
  'Giám đốc': '#8b5cf6',
};

// Generates a consistent color for any string
const _colorCache: Record<string, string> = {};
let _nextIdx = 0;
function getColor(key: string): string {
  if (KNOWN_ROLE_COLORS[key]) return KNOWN_ROLE_COLORS[key];
  if (_colorCache[key]) return _colorCache[key];
  // Skip colors already used by known roles
  const usedColors = new Set(Object.values(KNOWN_ROLE_COLORS));
  while (usedColors.has(VIVID_PALETTE[_nextIdx % VIVID_PALETTE.length])) _nextIdx++;
  _colorCache[key] = VIVID_PALETTE[_nextIdx % VIVID_PALETTE.length];
  _nextIdx++;
  return _colorCache[key];
}

const STATUS_COLORS: Record<string, string> = {
  'Done': '#22c55e',
  'In Progress': '#3b82f6',
  'Todo': '#f59e0b',
  'Review': '#8b5cf6',
};

const STATUS_LABELS: Record<string, string> = {
  'Done': 'Hoàn thành',
  'In Progress': 'Đang làm',
  'Todo': 'Chờ xử lý',
};

const DEPT_COLORS = [
  '#f97316', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6',
  '#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#6366f1',
];

// --- Sub Components ---

const StatCard: React.FC<{
  label: string;
  value: number;
  icon: React.ElementType;
  gradient: string;
  shadow: string;
  trend?: string;
  onClick?: () => void;
}> = ({ label, value, icon: Icon, gradient, shadow, trend, onClick }) => (
  <motion.div
    variants={fadeUp}
    whileHover={{ y: -4, scale: 1.02 }}
    onClick={onClick}
    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    className={`relative overflow-hidden bg-white rounded-2xl border border-gray-100 p-6 group ${onClick ? 'cursor-pointer hover:border-brand-200' : 'cursor-default'}`}
    style={{ boxShadow: `0 4px 24px -4px ${shadow}` }}
  >
    <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full ${gradient} opacity-[0.07] group-hover:opacity-[0.15] transition-opacity duration-500`} />
    <div className={`absolute bottom-0 left-0 w-full h-1 ${gradient} opacity-60`} />
    <div className="flex items-start justify-between relative">
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-4xl font-black text-gray-800 mt-1 tabular-nums">{value.toLocaleString()}</p>
        {trend && (
          <span className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
            <ArrowUpRight size={11} strokeWidth={2.5} /> {trend}
          </span>
        )}
      </div>
      <div className={`p-3.5 rounded-2xl ${gradient} shadow-lg`}>
        <Icon size={22} className="text-white" />
      </div>
    </div>
  </motion.div>
);

const SectionHeader: React.FC<{ icon: React.ElementType; title: string; subtitle: string }> = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-center gap-3 mb-6">
    <div className="p-2 bg-gradient-to-br from-orange-500 to-pink-500 rounded-xl">
      <Icon size={18} className="text-white" />
    </div>
    <div>
      <h3 className="text-base font-bold text-gray-800">{title}</h3>
      <p className="text-xs text-gray-400">{subtitle}</p>
    </div>
  </div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-100 shadow-xl rounded-xl p-3 text-sm">
        {label && <p className="font-bold text-gray-700 mb-1">{label}</p>}
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color }} className="font-medium">{p.name}: <span className="font-bold">{p.value}</span></p>
        ))}
      </div>
    );
  }
  return null;
};

const MetricRow: React.FC<{ label: string; value: React.ReactNode; icon: React.ElementType; color: string; onClick?: () => void }> = ({ label, value, icon: Icon, color, onClick }) => (
  <div 
    className={`flex items-center justify-between py-3 border-b border-gray-50 last:border-0 ${onClick ? 'cursor-pointer hover:bg-gray-50/80 rounded-lg px-2 -mx-2 transition-colors' : ''}`}
    onClick={onClick}
  >
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}15`, color }}>
        <Icon size={16} />
      </div>
      <span className="text-sm font-medium text-gray-600">{label}</span>
    </div>
    <span className="text-sm font-bold text-gray-800">{value}</span>
  </div>
);

// --- Main Admin Dashboard ---

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [resetRequests, setResetRequests] = useState<PasswordResetRequest[]>([]);
  
  const [showTableModal, setShowTableModal] = useState<{ visible: boolean; table: string; title: string }>({ visible: false, table: '', title: '' });
  const [modalData, setModalData] = useState<any[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  const fetchModalData = async (type: string, title?: string) => {
    setModalLoading(true);
    setModalData([]);
    setShowTableModal({ visible: true, table: type, title: title || '' });
    
    try {
      const url = `/api/admin/database/table/${type}?limit=20`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setModalData(data.rows);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setModalLoading(false);
    }
  };

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, resetRes] = await Promise.all([
        apiFetch('/api/admin/stats'),
        apiFetch('/api/admin/password-reset-requests')
      ]);
      if (!statsRes.ok) throw new Error(`Server error: ${statsRes.status}`);
      const data: AdminStats = await statsRes.json();
      setStats(data);
      if (resetRes.ok) setResetRequests(await resetRes.json());
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message || 'Không thể tải dữ liệu từ máy chủ.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 font-medium">Đang tải dữ liệu hệ thống...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-red-500">
        <AlertCircle size={48} strokeWidth={1.5} />
        <p className="font-semibold text-lg">{error || 'Lỗi không xác định'}</p>
        <button
          onClick={fetchStats}
          className="mt-2 px-5 py-2 bg-red-100 text-red-600 rounded-xl font-medium hover:bg-red-200 transition-colors flex items-center gap-2"
        >
          <RefreshCw size={16} /> Thử lại
        </button>
      </div>
    );
  }

  const roleChart = stats.roleBreakdown.map(r => ({ name: r.role || 'Không rõ', value: r.count }));
  const statusChart = stats.taskStatusBreakdown.map(s => ({
    name: STATUS_LABELS[s.status] || s.status || 'Chưa phân loại',
    status: s.status,
    value: s.count
  }));
  const deptChart = stats.taskDeptBreakdown.map(d => ({ name: d.department || 'Chưa phân', tasks: d.count }));

  const completionRate = stats.totalTasks > 0
    ? Math.round((stats.taskStatusBreakdown.find(s => s.status === 'Done')?.count || 0) / stats.totalTasks * 100)
    : 0;

  return (
    <motion.div className="space-y-8 pb-8" initial="hidden" animate="visible" variants={stagger}>

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-red-500 via-orange-500 to-yellow-400 rounded-2xl shadow-lg shadow-orange-200">
            <Shield size={26} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Trang Quản Trị</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Tổng quan toàn hệ thống · Chỉ dành cho Admin
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-400 flex items-center gap-1.5">
              <Clock size={12} /> Cập nhật: {lastUpdated.toLocaleTimeString('vi-VN')}
            </span>
          )}
          <button
            onClick={fetchStats}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 text-sm font-medium transition-all shadow-sm hover:shadow-md"
          >
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Tổng Người Dùng"
          value={stats.totalUsers}
          icon={Users}
          gradient="bg-gradient-to-br from-blue-500 to-cyan-400"
          shadow="rgba(59,130,246,0.25)"
          onClick={() => fetchModalData('users', 'Danh sách Người Dùng')}
        />
        <StatCard
          label="Công Việc Đang Làm"
          value={stats.totalTasks}
          icon={CheckSquare}
          gradient="bg-gradient-to-br from-orange-500 to-amber-400"
          shadow="rgba(249,115,22,0.25)"
          onClick={() => fetchModalData('tasks', 'Danh sách Công Việc')}
        />
        <StatCard
          label="Báo Cáo Đã Nhận"
          value={stats.totalReports}
          icon={FileText}
          gradient="bg-gradient-to-br from-purple-500 to-pink-500"
          shadow="rgba(168,85,247,0.25)"
          onClick={() => fetchModalData('reports', 'Danh sách Báo Cáo')}
        />
        <StatCard
          label="Cuộc Họp Đang Diễn Ra"
          value={stats.activeMeetings}
          icon={Video}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-400"
          shadow="rgba(16,185,129,0.25)"
          onClick={() => fetchModalData('meetings', 'Danh sách Cuộc Họp')}
        />
      </motion.div>

      {/* System Health & System Logs Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <SectionHeader
            icon={Server}
            title="Sức khỏe Máy chủ"
            subtitle="Chỉ số hoạt động thời gian thực"
          />
          <div className="mt-2">
            <MetricRow label="Node.js Version" value={stats.systemInfo?.nodeVersion || 'N/A'} icon={Server} color="#10b981" />
            <MetricRow label="RAM Usage" value={stats.systemInfo?.memoryUsage ? `${Math.round(stats.systemInfo.memoryUsage / 1024 / 1024)} MB` : 'N/A'} icon={Cpu} color="#3b82f6" />
            <MetricRow label="Kích thước Database" value={stats.systemInfo?.dbSize !== undefined ? `${(stats.systemInfo.dbSize / 1024 / 1024).toFixed(2)} MB` : 'N/A'} icon={Database} color="#f59e0b" />
            <MetricRow label="Uptime" value={stats.systemInfo?.uptime ? `${Math.floor(stats.systemInfo.uptime / 3600)}h ${Math.floor((stats.systemInfo.uptime % 3600) / 60)}m` : 'N/A'} icon={Activity} color="#8b5cf6" />
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <SectionHeader
            icon={Activity}
            title="Hoạt động Gần đây"
            subtitle="Tổng quan lượng tương tác hệ thống"
          />
          <div className="mt-2">
            <MetricRow label="Tổng Log Hệ thống" value={stats.totalLogs.toLocaleString()} icon={List} color="#f97316" onClick={() => fetchModalData('activity_logs', 'Log Hệ thống')} />
            <MetricRow label="Email Chờ Gửi" value={stats.scheduledEmails.toLocaleString()} icon={Mail} color="#ec4899" onClick={() => fetchModalData('scheduled_emails', 'Email chờ gửi')} />
            <MetricRow label="Email Đã Gửi" value={stats.sentEmails.toLocaleString()} icon={Send} color="#10b981" onClick={() => fetchModalData('mail_tracking', 'Email Đã Gửi')} />
            <MetricRow label="Yêu cầu Reset MK" value={stats.pendingResets.toLocaleString()} icon={Key} color="#3b82f6" onClick={() => fetchModalData('password_reset_requests', 'Yêu cầu Reset Mật khẩu')} />
          </div>
        </motion.div>
      </div>

      {/* System Health Bar */}
      <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-orange-500" />
            <span className="text-sm font-bold text-gray-700">Tỉ lệ Hoàn thành Công việc Toàn Hệ thống</span>
          </div>
          <span className="text-2xl font-black text-gray-800">{completionRate}%</span>
        </div>
        <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${completionRate}%` }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            className="h-full rounded-full relative"
            style={{
              background: 'linear-gradient(90deg, #f97316, #eab308, #22c55e)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 2s linear infinite',
            }}
          />
        </div>
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        <div className="flex gap-6 mt-3">
          {stats.taskStatusBreakdown.map(s => (
            <div key={s.status} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] || '#94a3b8' }} />
              <span className="text-xs text-gray-500">{STATUS_LABELS[s.status] || s.status}: <strong>{s.count}</strong></span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Role Distribution Pie Chart */}
        <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <SectionHeader
            icon={PieIcon}
            title="Phân bổ Vai trò Người dùng"
            subtitle="Số lượng thành viên theo từng cấp bậc"
          />
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={roleChart}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={4}
                dataKey="value"
                nameKey="name"
              >
                {roleChart.map((entry, index) => (
                  <Cell key={`role-${index}`} fill={getColor(entry.name)} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Role Stats below */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            {stats.roleBreakdown.map(r => (
              <div key={r.role} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getColor(r.role) }} />
                  <span className="text-xs font-medium text-gray-600">{r.role}</span>
                </div>
                <span className="text-sm font-bold text-gray-800">{r.count}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Task Status Pie Chart */}
        <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
          <SectionHeader
            icon={BarChart2}
            title="Trạng thái Công việc"
            subtitle="Tỉ lệ công việc theo trạng thái hiện tại"
          />
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={statusChart}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={4}
                dataKey="value"
                nameKey="name"
              >
                {statusChart.map((entry, index) => (
                  <Cell key={`status-${index}`} fill={STATUS_COLORS[entry.status] || '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {stats.taskStatusBreakdown.map(s => {
              const icons: Record<string, React.ReactNode> = {
                Done: <CheckCircle size={14} className="text-emerald-500" />,
                'In Progress': <Activity size={14} className="text-blue-500" />,
                Todo: <XCircle size={14} className="text-amber-500" />,
              };
              return (
                <div key={s.status || 'unknown'} className="flex flex-col items-center bg-gray-50 py-3 rounded-xl gap-1">
                  {icons[s.status] || <AlertCircle size={14} className="text-gray-400" />}
                  <span className="text-lg font-black text-gray-800">{s.count}</span>
                  <span className="text-xs text-gray-400">{STATUS_LABELS[s.status] || s.status || 'Chưa phân loại'}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Charts Row 2: Departments and Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task by Department Bar Chart */}
        {deptChart.length > 0 ? (
          <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
            <SectionHeader
              icon={BarChart2}
              title="Công việc theo Phòng Ban"
              subtitle="Số lượng công việc được giao theo từng bộ phận"
            />
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={deptChart} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(249,115,22,0.08)' }} />
                <Bar dataKey="tasks" name="Công việc" radius={[6, 6, 0, 0]}>
                  {deptChart.map((_, index) => (
                    <Cell key={`dept-${index}`} fill={DEPT_COLORS[index % DEPT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        ) : <div />}

        {/* Report Status */}
        <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col">
          <SectionHeader
            icon={FileText}
            title="Thống kê Báo cáo"
            subtitle="Tình trạng báo cáo trong hệ thống"
          />
          <div className="flex-1 flex flex-col justify-center gap-4">
            {stats.reportStatusBreakdown.length === 0 ? (
              <p className="text-gray-400 text-sm text-center">Chưa có báo cáo nào</p>
            ) : (
              stats.reportStatusBreakdown.map(r => {
                let color = '#94a3b8';
                let label = r.status;
                if (r.status === 'Approved') { color = '#22c55e'; label = 'Đã duyệt'; }
                if (r.status === 'Pending') { color = '#f59e0b'; label = 'Chờ duyệt'; }
                if (r.status === 'Rejected') { color = '#ef4444'; label = 'Yêu cầu làm lại'; }
                
                const percent = Math.round((r.count / stats.totalReports) * 100);
                
                return (
                  <div key={r.status} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        {label}
                      </span>
                      <span className="font-bold text-gray-900">{r.count} <span className="text-gray-400 font-normal">({percent}%)</span></span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>

      {/* Password Reset Requests */}
      <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <SectionHeader
          icon={Clock}
          title="Yêu cầu quên mật khẩu"
          subtitle="Danh sách người dùng đang chờ admin cấp lại mật khẩu"
        />
        {resetRequests.length === 0 ? (
          <div className="text-sm text-gray-400">Hiện chưa có yêu cầu nào.</div>
        ) : (
          <div className="space-y-3">
            {resetRequests.map((request) => (
              <div key={request.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{request.email}</p>
                  <p className="text-xs text-gray-400">{new Date(request.createdAt).toLocaleString('vi-VN')} · {request.status === 'pending' ? 'Đang chờ xử lý' : 'Đã xử lý'}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${request.status === 'pending' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {request.status === 'pending' ? 'Pending' : 'Resolved'}
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Quick Role Summary Table */}
      <motion.div variants={fadeUp} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm overflow-hidden relative">
        <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-brand-50 to-transparent rounded-bl-full opacity-50 pointer-events-none" />
        <SectionHeader
          icon={UserCheck}
          title="Bảng Phân quyền Hệ thống"
          subtitle="Tổng hợp số lượng nhân sự theo vai trò"
        />
        <div className="overflow-x-auto relative">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-4 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Vai Trò</th>
                <th className="text-left py-4 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Số lượng</th>
                <th className="text-left py-4 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Tỉ lệ</th>
                <th className="text-left py-4 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Mô tả Quyền hạn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.roleBreakdown.map(r => {
                const percent = Math.round((r.count / stats.totalUsers) * 100);
                const permissions: Record<string, string> = {
                  Admin: 'Quản trị viên: Toàn quyền truy cập, cài đặt hệ thống, toàn quyền kho',
                  Director: 'Giám đốc: Xem tổng quan, duyệt báo cáo, giám sát kho và đối soát MISA',
                  Manager: 'Quản lý: Điều phối nhân sự, giao việc phòng ban, quản lý vận hành kho',
                  Employee: 'Nhân viên: Xử lý công việc được giao, nhận/xuất/điều chuyển và kiểm kê kho',
                };
                return (
                  <tr key={r.role} className="hover:bg-brand-50/30 transition-colors group">
                    <td className="py-4 px-4">
                      <span
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm"
                        style={{
                          backgroundColor: `${getColor(r.role)}15`,
                          color: getColor(r.role),
                          border: `1px solid ${getColor(r.role)}30`
                        }}
                      >
                        <span className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: getColor(r.role) }} />
                        {r.role}
                      </span>
                    </td>
                    <td className="py-4 px-4 font-black text-gray-800 text-base">{r.count} <span className="text-xs font-normal text-gray-400">người</span></td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                          <div
                            className="h-full rounded-full relative"
                            style={{ width: `${percent}%`, backgroundColor: getColor(r.role) }}
                          >
                            <div className="absolute inset-0 bg-white/20 w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }} />
                          </div>
                        </div>
                        <span className="text-xs font-bold text-gray-600 w-8">{percent}%</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600 font-medium group-hover:text-gray-900 transition-colors">{permissions[r.role] || 'Thành viên hệ thống'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Modals */}
      {showTableModal.visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-brand-100 text-brand-600">
                  <Database size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">
                    {showTableModal.title}
                  </h3>
                  <p className="text-xs text-gray-500">Bản ghi hệ thống (tối đa 20)</p>
                </div>
              </div>
              <button 
                onClick={() => { setShowTableModal({ visible: false, table: '', title: '' }); }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-0 overflow-y-auto flex-1 bg-white">
              {modalLoading ? (
                <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-gray-400" size={32} /></div>
              ) : modalData.length === 0 ? (
                <p className="text-center text-gray-400 py-20">Không có dữ liệu</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0 border-b border-gray-200">
                      <tr>
                        {Object.keys(modalData[0] || {}).filter(k => k !== 'password' && k !== 'passwordHash').map(key => (
                          <th key={key} className="px-4 py-3 font-semibold">{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {modalData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-brand-50/30">
                          {Object.entries(row).filter(([k]) => k !== 'password' && k !== 'passwordHash').map(([k, v]: [string, any], i) => (
                            <td key={i} className="px-4 py-3 text-gray-600 truncate max-w-[200px]" title={String(v)}>
                              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

    </motion.div>
  );
}
