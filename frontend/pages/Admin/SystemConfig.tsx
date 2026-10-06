import { apiFetch } from '../../services/api';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Database, Server, Activity, CheckCircle,
  AlertCircle, RefreshCw, HardDrive, Users, CheckSquare,
  FileText, Video, ArrowUpCircle, Clock, Save, ShieldCheck, Trash2, Brain
} from 'lucide-react';

interface SystemInfo {
  totalUsers: number;
  totalTasks: number;
  totalReports: number;
  activeMeetings: number;
  systemInfo?: {
    nodeVersion: string;
    platform: string;
    memoryUsage: number;
    uptime: number;
    dbSize: number;
  };
}



const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
    <span className="text-sm text-gray-500">{label}</span>
    <span className="text-sm font-semibold text-gray-800">{value}</span>
  </div>
);

const StatusBadge: React.FC<{ ok: boolean; label?: string }> = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border
    ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'} animate-pulse`} />
    {label || (ok ? 'Online' : 'Offline')}
  </span>
);

export default function AdminSystemConfig() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(false);
  const [uptime] = useState<string>(() => {
    const start = new Date();
    return start.toLocaleTimeString('vi-VN');
  });
  const [currentTime, setCurrentTime] = useState(new Date());

  const [aiKeysMap, setAiKeysMap] = useState<Record<string, any[]>>({});
  const [aiProvider, setAiProvider] = useState<string>('gemini');
  const [aiKeysLoading, setAiKeysLoading] = useState(false);
  const [aiKeysSaving, setAiKeysSaving] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; provider: string; keyCount: number } | null>(null);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, { status: string; lastChecked: number }>>({});

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    const keysId = setInterval(async () => {
      try {
        const res = await apiFetch('/api/ai/keys-status');
        if (res.ok) {
          const d = await res.json();
          setKeyStatuses(d.statuses || {});
        }
      } catch {}
    }, 5000);
    return () => { clearInterval(id); clearInterval(keysId); };
  }, []);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setAiKeysLoading(true);
    try {
      const [statsRes, aiKeysRes, aiStatusRes, keysStatusRes] = await Promise.all([
        apiFetch('/api/admin/stats'),
        apiFetch('/api/admin/system-config/ai-keys'),
        apiFetch('/api/ai/status'),
        apiFetch('/api/ai/keys-status'),
      ]);
      if (statsRes.ok) {
        const data = await statsRes.json();
        setInfo(data);
        setBackendOk(true);
      } else {
        setBackendOk(false);
      }
      if (aiKeysRes.ok) {
        const aiData = await aiKeysRes.json();
        if (aiData.keysMap) setAiKeysMap(aiData.keysMap);
        if (aiData.provider) setAiProvider(aiData.provider);
      }
      if (aiStatusRes.ok) {
        setAiStatus(await aiStatusRes.json());
      }
      if (keysStatusRes.ok) {
        const d = await keysStatusRes.json();
        setKeyStatuses(d.statuses || {});
      }
    } catch {
      setBackendOk(false);
    } finally {
      setLoading(false);
      setAiKeysLoading(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const handleAddAiKey = () => setAiKeysMap(prev => ({ ...prev, [aiProvider]: [...(prev[aiProvider] || []), ''] }));
  const handleRemoveAiKey = (index: number) => setAiKeysMap(prev => {
    const newArr = [...(prev[aiProvider] || [])];
    newArr.splice(index, 1);
    return { ...prev, [aiProvider]: newArr };
  });
  const handleChangeAiKey = (index: number, value: string) => {
    setAiKeysMap(prev => {
      const newArr = [...(prev[aiProvider] || [])];
      newArr[index] = value;
      return { ...prev, [aiProvider]: newArr };
    });
  };

  const [testingKey, setTestingKey] = useState<string | null>(null);
  const handleTestKey = async (key: string) => {
    if (!key.trim()) return;
    setTestingKey(key);
    try {
      const res = await apiFetch('/api/ai/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: aiProvider, apiKey: key })
      });
      const data = await res.json();
      if (data.status) {
        setKeyStatuses(prev => ({ ...prev, [key]: { status: data.status, lastChecked: Date.now() } }));
      }
    } catch (e) {
      setKeyStatuses(prev => ({ ...prev, [key]: { status: 'Unknown', lastChecked: Date.now() } }));
    } finally {
      setTestingKey(null);
    }
  };

  const saveAiKeysConfig = async () => {
    setAiKeysSaving(true);
    setAiMessage(null);
    try {
      const cleanMap: Record<string, any[]> = {};
      for (const p in aiKeysMap) {
        cleanMap[p] = (aiKeysMap[p] || []).filter(k => {
          if (typeof k === 'string') return k.trim().length > 0;
          return Boolean(k?.fingerprint);
        });
      }
      
      const res = await apiFetch('/api/admin/system-config/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keysMap: cleanMap, provider: aiProvider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lưu cấu hình AI thất bại');
      setAiMessage({ type: 'success', text: 'Đã lưu cấu hình AI thành công.' });
      setAiKeysMap(cleanMap);
      // Refresh AI status after saving
      const statusRes = await apiFetch('/api/ai/status');
      if (statusRes.ok) setAiStatus(await statusRes.json());
    } catch (e: any) {
      setAiMessage({ type: 'error', text: e.message || 'Lưu cấu hình AI Keys thất bại.' });
    } finally {
      setAiKeysSaving(false);
    }
  };

  const dataItems = info ? [
    { icon: Users, label: 'Người dùng', value: info.totalUsers, color: 'text-blue-500', bg: 'bg-blue-50' },
    { icon: CheckSquare, label: 'Công việc', value: info.totalTasks, color: 'text-purple-500', bg: 'bg-purple-50' },
    { icon: FileText, label: 'Báo cáo', value: info.totalReports, color: 'text-orange-500', bg: 'bg-orange-50' },
    { icon: Video, label: 'Cuộc họp đang mở', value: info.activeMeetings, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  ] : [];

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl shadow-lg shadow-slate-200">
          <Settings size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900">Cấu hình Hệ thống</h1>
          <p className="text-sm text-gray-400 mt-0.5">Thông tin kỹ thuật và trạng thái máy chủ</p>
        </div>
      </div>

      {/* Status Cards - 4 columns including AI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* AI Provider Card */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain size={18} className="text-violet-600" />
              <span className="font-bold text-gray-700 text-sm">AI Provider</span>
            </div>
            {aiStatus === null ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-gray-50 text-gray-400 border-gray-200">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                Đang tải...
              </span>
            ) : aiStatus.configured ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-50 text-amber-700 border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Missing Keys
              </span>
            )}
          </div>
          <div className="space-y-1">
            <InfoRow label="Provider" value={aiStatus?.provider ? {
              gemini: 'Google Gemini',
              groq: 'Groq (Llama 3)',
              deepseek: 'DeepSeek',
              openrouter: 'OpenRouter',
              openai: 'OpenAI',
            }[aiStatus.provider] || aiStatus.provider : 'Đang tải...'} />
            <InfoRow label="API Keys" value={aiStatus !== null ? `${aiStatus.keyCount} key${aiStatus.keyCount !== 1 ? 's' : ''}` : '...'} />
            <InfoRow label="Key Rotation" value={aiStatus?.keyCount && aiStatus.keyCount > 1 ? '✅ Bật' : '—'} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server size={18} className="text-slate-600" />
              <span className="font-bold text-gray-700 text-sm">API Server</span>
            </div>
            <StatusBadge ok={backendOk} />
          </div>
          <div className="space-y-1">
            <InfoRow label="Node.js" value={info?.systemInfo?.nodeVersion || 'Đang tải...'} />
            <InfoRow label="Nền tảng" value={info?.systemInfo?.platform === 'win32' ? 'Windows' : info?.systemInfo?.platform || 'Đang tải...'} />
            <InfoRow label="RAM Server" value={info?.systemInfo?.memoryUsage ? `${Math.round(info.systemInfo.memoryUsage / 1024 / 1024)} MB` : 'Đang tải...'} />
            <InfoRow label="Thời gian chạy (Uptime)" value={info?.systemInfo?.uptime ? `${Math.floor(info.systemInfo.uptime / 3600)} giờ ${Math.floor((info.systemInfo.uptime % 3600) / 60)} phút` : 'Đang tính...'} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Database size={18} className="text-slate-600" />
              <span className="font-bold text-gray-700 text-sm">Database</span>
            </div>
            <StatusBadge ok={backendOk} label="Connected" />
          </div>
          <div className="space-y-1">
            <InfoRow label="Engine" value="MySQL 8" />
            <InfoRow label="Client" value="mysql2" />
            <InfoRow label="Kích thước" value={info?.systemInfo?.dbSize !== undefined ? `${(info.systemInfo.dbSize / 1024 / 1024).toFixed(2)} MB` : 'Đang tính...'} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-slate-600" />
              <span className="font-bold text-gray-700 text-sm">Frontend</span>
            </div>
            <StatusBadge ok={true} label="Running" />
          </div>
          <div className="space-y-1">
            <InfoRow label="Framework" value="React 18" />
            <InfoRow label="Build Tool" value="Vite 6" />
            <InfoRow label="Ngôn ngữ" value="TypeScript" />
          </div>
        </div>
      </div>

      {/* System Clock */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl shadow-slate-200">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Clock size={12} /> Thời gian hệ thống
            </p>
            <p className="text-4xl font-black font-mono tracking-tight">
              {currentTime.toLocaleTimeString('vi-VN')}
            </p>
            <p className="text-slate-300 text-sm mt-1">
              {currentTime.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-slate-400 text-xs mb-0.5">Timezone</p>
              <p className="font-bold">Asia/Ho_Chi_Minh</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-slate-400 text-xs mb-0.5">Phiên bắt đầu lúc</p>
              <p className="font-bold font-mono">{uptime}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-slate-400 text-xs mb-0.5">Môi trường</p>
              <p className="font-bold">Development</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-slate-400 text-xs mb-0.5">Node.js</p>
              <p className="font-bold">≥ 18.x</p>
            </div>
          </div>
        </div>
      </div>


      {/* AI API Keys Configuration */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-gray-600" />
            <h3 className="font-bold text-gray-700">Cấu hình Gemini API Keys</h3>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200">
            <ShieldCheck size={12} /> Rotate tự động
          </span>
        </div>

        {aiMessage && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium border ${aiMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
            {aiMessage.text}
          </div>
        )}

        {aiKeysLoading ? (
          <div className="py-8 text-center text-gray-400">Đang tải cấu hình AI Keys...</div>
        ) : (
          <div className="space-y-4">
            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5 mb-4">
              <label className="block text-sm font-bold text-gray-800 mb-2">Nhà Cung Cấp AI (AI Provider)</label>
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-400 outline-none font-medium bg-white"
              >
                <option value="gemini">Google Gemini (Mặc định)</option>
                <option value="groq">Groq (Llama 3 / Mixtral - Siêu Nhanh)</option>
                <option value="deepseek">DeepSeek (Giá Rẻ - Thông Minh)</option>
                <option value="openrouter">OpenRouter (Đa dạng Mô Hình)</option>
                <option value="openai">OpenAI (ChatGPT / GPT-4)</option>
              </select>
              <p className="text-xs text-gray-500 mt-2">
                Hệ thống sẽ dựa vào Provider này để thay đổi chuẩn kết nối. Hãy đảm bảo API Keys bên dưới tương ứng với Provider bạn chọn.
              </p>
            </div>

            <p className="text-sm font-bold text-gray-800">Danh sách API Keys</p>
            <p className="text-xs text-gray-500 mb-2">Hệ thống sẽ tự động dùng key đầu tiên. Nếu bị giới hạn (Rate Limit), sẽ tự động chuyển sang key tiếp theo trong danh sách.</p>
            
            <div className="space-y-3">
              {(aiKeysMap[aiProvider] || []).map((key, index) => (
                <div key={index} className="flex gap-2">
                  <span className="inline-flex items-center justify-center w-10 bg-gray-100 text-gray-500 font-mono text-sm rounded-xl border border-gray-200">
                    {index + 1}
                  </span>
                  <div className="relative flex-1 flex items-center">
                    <input
                      type="text"
                      value={typeof key === 'string' ? key : key.masked}
                      onChange={(e) => handleChangeAiKey(index, e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full px-4 py-2 pr-24 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-400 outline-none font-mono text-sm"
                    />
                    {(typeof key === 'string' ? key.trim() : key.fingerprint) && (
                      <div className="absolute right-2">
                        {(() => {
                          const statusKey = typeof key === 'string' ? key : key.fingerprint;
                          const status = keyStatuses[statusKey]?.status || 'Unknown';
                          if (status === 'Active') return <span className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">Hoạt động</span>;
                          if (status === 'Rate Limited') return <span className="px-2 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-[11px] font-bold">Quá tải</span>;
                          if (status === 'Quota Exceeded') return <span className="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">Hết Quota</span>;
                          if (status === 'Invalid') return <span className="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">Lỗi Key</span>;
                          return <span className="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 text-[11px] font-bold">Chưa test</span>;
                        })()}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleTestKey(key)}
                      disabled={typeof key !== 'string' || testingKey === key || !key.trim()}
                      className="px-3 py-2 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors whitespace-nowrap"
                      title="Kiểm tra Key"
                    >
                      {testingKey === key ? 'Đang test...' : 'Test Key'}
                    </button>
                    <button
                      onClick={() => handleRemoveAiKey(index)}
                      className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                      title="Xóa key"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={handleAddAiKey}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
              >
                + Thêm API Key mới
              </button>
              
              <button
                onClick={saveAiKeysConfig}
                disabled={aiKeysSaving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 text-white font-bold shadow-lg shadow-brand-200 hover:bg-brand-600 transition-all disabled:opacity-60"
              >
                <Save size={16} /> {aiKeysSaving ? 'Đang lưu...' : 'Lưu danh sách Keys'}
              </button>
            </div>
          </div>
        )}
      </div>


      {/* Database Stats */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-gray-600" />
            <h3 className="font-bold text-gray-700">Thống kê Cơ sở dữ liệu</h3>
          </div>
          <button onClick={fetchInfo}
            className="text-xs flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors">
            <RefreshCw size={12} /> Làm mới
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
            <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            Đang tải...
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {dataItems.map(item => (
              <div key={item.label} className={`${item.bg} rounded-xl p-4 text-center`}>
                <item.icon className={`${item.color} mx-auto mb-2`} size={22} />
                <p className="text-2xl font-black text-gray-800">{item.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tech Stack */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <ArrowUpCircle size={18} className="text-gray-600" />
          <h3 className="font-bold text-gray-700">Technology Stack</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { category: 'Frontend', items: ['React 18', 'TypeScript', 'Vite 6', 'Tailwind CSS', 'Recharts', 'Lucide Icons', 'React Router v6'] },
            { category: 'Backend', items: ['Node.js', 'Express.js', 'TypeScript', 'MySQL 8 (mysql2)', 'dotenv', 'CORS'] },
          ].map(section => (
            <div key={section.category}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{section.category}</p>
              <div className="flex flex-wrap gap-2">
                {section.items.map(item => (
                  <span key={item}
                    className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full border border-gray-200 hover:bg-gray-200 transition-colors">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Endpoints */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <Activity size={18} className="text-gray-600" />
          <h3 className="font-bold text-gray-700">API Endpoints đang hoạt động</h3>
        </div>
        <div className="space-y-2">
          {[
            { method: 'GET', path: '/api/users', desc: 'Danh sách người dùng' },
            { method: 'POST', path: '/api/users', desc: 'Tạo người dùng mới' },
            { method: 'PUT', path: '/api/users/:id', desc: 'Cập nhật người dùng' },
            { method: 'DELETE', path: '/api/users/:id', desc: 'Xóa người dùng' },
            { method: 'GET', path: '/api/tasks', desc: 'Danh sách công việc' },
            { method: 'POST/PUT/DELETE', path: '/api/tasks/:id', desc: 'Quản lý công việc' },
            { method: 'GET', path: '/api/reports', desc: 'Danh sách báo cáo' },
            { method: 'POST/PUT/DELETE', path: '/api/reports/:id', desc: 'Quản lý báo cáo' },
            { method: 'GET', path: '/api/meetings', desc: 'Danh sách cuộc họp' },
            { method: 'GET', path: '/api/admin/stats', desc: 'Thống kê quản trị hệ thống' },
          ].map((ep, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 px-4 rounded-xl hover:bg-gray-50 transition-colors">
              <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono min-w-[90px] text-center
                ${ep.method.startsWith('GET') ? 'bg-emerald-100 text-emerald-700' :
                  ep.method.startsWith('POST') ? 'bg-blue-100 text-blue-700' :
                  ep.method.startsWith('PUT') ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'}`}>
                {ep.method}
              </span>
              <code className="text-sm text-gray-700 font-mono bg-gray-100 px-2 py-0.5 rounded">{ep.path}</code>
              <span className="text-sm text-gray-400 ml-auto">{ep.desc}</span>
              <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
