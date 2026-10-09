import { apiFetch } from '../../services/api';
import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Server, ShieldCheck, Save, Eye, EyeOff } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface SmtpConfig {
  IMAP_HOST: string;
  IMAP_PORT: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
}

export default function AdminMailServerConfig() {
  const [smtpConfig, setSmtpConfig] = useState<SmtpConfig>({
    IMAP_HOST: 'mail.tranlecorp.com.vn',
    IMAP_PORT: '993',
    SMTP_HOST: 'mail.tranlecorp.com.vn',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
  });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMessage, setSmtpMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');

  const [posteApiConfig, setPosteApiConfig] = useState({ POSTE_API_URL: '', POSTE_API_USER: '', POSTE_API_PASS: '' });
  const [posteBoxes, setPosteBoxes] = useState<any[]>([]);
  const [posteLoading, setPosteLoading] = useState(false);
  const [posteSaving, setPosteSaving] = useState(false);
  const [posteMessage, setPosteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPosteModal, setShowPosteModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [posteFormData, setPosteFormData] = useState({ name: '', email: '', passwordPlaintext: '', quota: 0 });

  const [posteAliases, setPosteAliases] = useState<any[]>([]);
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [aliasFormData, setAliasFormData] = useState({ name: '', email: '', goto: '' });

  const [posteDomains, setPosteDomains] = useState<any[]>([]);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [domainFormData, setDomainFormData] = useState({ name: '' });

  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; action: () => void }>({ isOpen: false, title: '', message: '', action: () => {} });

  const fetchInfo = useCallback(async () => {
    setSmtpLoading(true);
    try {
      const [smtpRes, posteApiRes] = await Promise.all([
        apiFetch('/api/admin/system-config/smtp'),
        apiFetch('/api/admin/system-config/poste-api')
      ]);
      if (smtpRes.ok) {
        const smtpData = await smtpRes.json();
        setSmtpConfig(smtpData);
        setTestEmail(prev => prev || smtpData.SMTP_USER);
      }
      if (posteApiRes.ok) {
        const posteData = await posteApiRes.json();
        setPosteApiConfig(posteData);
        if (posteData.POSTE_API_URL && posteData.POSTE_API_USER && posteData.POSTE_API_PASS) {
          fetchPosteBoxes();
          fetchPosteAliases();
          fetchPosteDomains();
        }
      }
    } catch {
      // ignore
    } finally {
      setSmtpLoading(false);
    }
  }, []);

  const fetchPosteBoxes = async () => {
    setPosteLoading(true);
    try {
      const res = await apiFetch('/api/admin/mail-server/boxes');
      if (res.ok) {
        const data = await res.json();
        setPosteBoxes(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to fetch poste boxes', e);
    } finally {
      setPosteLoading(false);
    }
  };

  const fetchPosteAliases = async () => {
    try {
      const res = await apiFetch('/api/admin/mail-server/aliases');
      if (res.ok) {
        const data = await res.json();
        setPosteAliases(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to fetch poste aliases', e);
    }
  };

  const fetchPosteDomains = async () => {
    try {
      const res = await apiFetch('/api/admin/mail-server/domains');
      if (res.ok) {
        const data = await res.json();
        setPosteDomains(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to fetch poste domains', e);
    }
  };

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const handleSmtpChange = (field: keyof SmtpConfig, value: string) => {
    setSmtpConfig(prev => ({ ...prev, [field]: value }));
  };

  const useTranleWebmailPreset = () => {
    setSmtpConfig(prev => ({
      ...prev,
      IMAP_HOST: 'mail.tranlecorp.com.vn',
      IMAP_PORT: '993',
      SMTP_HOST: 'mail.tranlecorp.com.vn',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
    }));
  };

  const saveSmtpConfig = async () => {
    setSmtpSaving(true);
    setSmtpMessage(null);
    try {
      const res = await apiFetch('/api/admin/system-config/smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(smtpConfig),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lưu cấu hình SMTP thất bại');
      setSmtpMessage({ type: 'success', text: 'Đã lưu cấu hình SMTP thành công.' });
      await fetchInfo();
    } catch (e: any) {
      setSmtpMessage({ type: 'error', text: e.message || 'Lưu cấu hình SMTP thất bại.' });
    } finally {
      setSmtpSaving(false);
    }
  };

  const testSmtpConfig = async () => {
    setSmtpTesting(true);
    setSmtpMessage(null);
    try {
      const res = await apiFetch('/api/admin/system-config/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Test SMTP thất bại');
      setSmtpMessage({ type: 'success', text: `Đã gửi mail test thành công tới ${testEmail || smtpConfig.SMTP_USER}.` });
    } catch (e: any) {
      setSmtpMessage({ type: 'error', text: e.message || 'Test SMTP thất bại.' });
    } finally {
      setSmtpTesting(false);
    }
  };

  const savePosteApiConfig = async () => {
    setPosteSaving(true);
    setPosteMessage(null);
    try {
      const res = await apiFetch('/api/admin/system-config/poste-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(posteApiConfig),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lưu cấu hình Poste.io thất bại');
      setPosteMessage({ type: 'success', text: 'Đã lưu cấu hình Poste API thành công.' });
      fetchPosteBoxes();
      fetchPosteAliases();
      fetchPosteDomains();
    } catch (e: any) {
      setPosteMessage({ type: 'error', text: e.message || 'Lưu cấu hình Poste.io thất bại.' });
    } finally {
      setPosteSaving(false);
    }
  };

  const createOrUpdatePosteBox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posteFormData.name || !posteFormData.email) return;
    try {
      const isUpdate = posteBoxes.some(b => (b.email || b.emailAddress || b.address || b.login || b.id) === posteFormData.email);
      const url = isUpdate ? `/api/admin/mail-server/boxes/${encodeURIComponent(posteFormData.email)}` : '/api/admin/mail-server/boxes';
      const method = isUpdate ? 'PATCH' : 'POST';
      const payload: any = { ...posteFormData };
      if (isUpdate) {
        delete payload.email;
        if (!payload.passwordPlaintext) {
          delete payload.passwordPlaintext;
        }
      }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      fetchPosteBoxes();
      setShowPosteModal(false);
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('<!DOCTYPE') || msg.includes('Zimbra') || msg.includes('404')) {
        alert('Lỗi: Cấu hình URL API hiện tại đang trỏ về máy chủ không hỗ trợ Poste.io (Có thể là Zimbra cũ). Vui lòng kiểm tra lại URL API hoặc trỏ đúng DNS.');
      } else {
        alert('Lỗi: ' + msg);
      }
    }
  };

  const deletePosteBox = async (email: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Xóa hộp thư',
      message: `Bạn có chắc muốn xóa vĩnh viễn hộp thư ${email}?`,
      action: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          const res = await apiFetch(`/api/admin/mail-server/boxes/${encodeURIComponent(email)}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text());
          fetchPosteBoxes();
        } catch (e: any) {
          const msg = e.message || '';
          alert('Lỗi xóa: ' + (msg.includes('<!DOCTYPE') ? 'Cấu hình API sai hoặc URL trỏ về máy chủ cũ.' : msg));
        }
      }
    });
  };

  const togglePosteBox = async (email: string, currentStatus: string) => {
    try {
      const disabled = currentStatus !== 'Active';
      const res = await apiFetch(`/api/admin/mail-server/boxes/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !disabled })
      });
      if (!res.ok) throw new Error(await res.text());
      fetchPosteBoxes();
    } catch (e: any) {
      const msg = e.message || '';
      alert('Lỗi khóa/mở: ' + (msg.includes('<!DOCTYPE') ? 'Cấu hình API sai hoặc URL trỏ về máy chủ cũ.' : msg));
    }
  };

  const createOrUpdateAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aliasFormData.email || !aliasFormData.goto) return;
    try {
      const isUpdate = posteAliases.some(a => (a.email || a.address || a.login || a.id) === aliasFormData.email);
      const url = isUpdate ? `/api/admin/mail-server/aliases/${encodeURIComponent(aliasFormData.email)}` : '/api/admin/mail-server/aliases';
      const method = isUpdate ? 'PATCH' : 'POST';
      
      const payload = isUpdate ? { goto: aliasFormData.goto } : aliasFormData;

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      fetchPosteAliases();
      setShowAliasModal(false);
    } catch (e: any) {
      const msg = e.message || '';
      alert('Lỗi Alias: ' + (msg.includes('<!DOCTYPE') ? 'Cấu hình API sai hoặc URL trỏ về máy chủ cũ.' : msg));
    }
  };

  const deleteAlias = async (email: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Xóa bí danh',
      message: `Bạn có chắc muốn xóa bí danh ${email}?`,
      action: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          const res = await apiFetch(`/api/admin/mail-server/aliases/${encodeURIComponent(email)}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text());
          fetchPosteAliases();
        } catch (e: any) {
          const msg = e.message || '';
          alert('Lỗi xóa: ' + (msg.includes('<!DOCTYPE') ? 'Cấu hình API sai hoặc URL trỏ về máy chủ cũ.' : msg));
        }
      }
    });
  };

  const createDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainFormData.name) return;
    try {
      const res = await apiFetch('/api/admin/mail-server/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(domainFormData)
      });
      if (!res.ok) throw new Error(await res.text());
      fetchPosteDomains();
      setShowDomainModal(false);
    } catch (e: any) {
      const msg = e.message || '';
      alert('Lỗi Domain: ' + (msg.includes('<!DOCTYPE') ? 'Cấu hình API sai hoặc URL trỏ về máy chủ cũ.' : msg));
    }
  };

  const deleteDomain = async (name: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Xóa tên miền',
      message: `Bạn có chắc muốn xóa tên miền ${name}? Việc này sẽ xóa toàn bộ hộp thư thuộc tên miền này!`,
      action: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          const res = await apiFetch(`/api/admin/mail-server/domains/${encodeURIComponent(name)}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text());
          fetchPosteDomains();
        } catch (e: any) {
          const msg = e.message || '';
          alert('Lỗi xóa: ' + (msg.includes('<!DOCTYPE') ? 'Cấu hình API sai hoặc URL trỏ về máy chủ cũ.' : msg));
        }
      }
    });
  };


  const isBoxUpdateRender = posteBoxes.some(b => (b.email || b.emailAddress || b.address || b.login || b.id) === posteFormData.email);
  const isAliasUpdateRender = posteAliases.some(a => (a.email || a.address || a.login || a.id) === aliasFormData.email);

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-gradient-to-br from-blue-700 to-indigo-900 rounded-2xl shadow-lg shadow-blue-200">
          <Mail size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900">Quản lý Mail Server</h1>
          <p className="text-sm text-gray-400 mt-0.5">Cấu hình SMTP và hộp thư người dùng</p>
        </div>
      </div>

      {/* Poste.io Mail Server Configuration */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-gray-600" />
            <h3 className="font-bold text-gray-700">Quản trị Máy chủ Mail (Poste.io)</h3>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200">
            <ShieldCheck size={12} /> API Integration
          </span>
        </div>

        {posteMessage && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium border ${posteMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
            {posteMessage.text}
          </div>
        )}

        <div className="space-y-6">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <h4 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Server size={16} className="text-blue-500" /> Cấu hình API Máy chủ
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Poste.io API URL</label>
                <input value={posteApiConfig.POSTE_API_URL} onChange={e => setPosteApiConfig(p => ({ ...p, POSTE_API_URL: e.target.value }))} placeholder="https://mail.tranlecorp.com.vn/admin/api/v1" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Tài khoản Admin (Email)</label>
                <input value={posteApiConfig.POSTE_API_USER} onChange={e => setPosteApiConfig(p => ({ ...p, POSTE_API_USER: e.target.value }))} placeholder="admin@tranlecorp.com.vn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Mật khẩu Admin</label>
                <input type="password" value={posteApiConfig.POSTE_API_PASS} onChange={e => setPosteApiConfig(p => ({ ...p, POSTE_API_PASS: e.target.value }))} placeholder="Nhập hoặc giữ nguyên" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none" />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={savePosteApiConfig} disabled={posteSaving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition-colors disabled:opacity-60">
                <Save size={16} /> {posteSaving ? 'Đang lưu...' : 'Lưu & Kết nối API'}
              </button>
            </div>
          </div>


          {/* Domains List */}
          {!posteApiConfig.POSTE_API_URL || !posteApiConfig.POSTE_API_USER ? (
            <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-xl border border-gray-200 border-dashed">
              Vui lòng điền thông tin và bấm <b>Lưu & Kết nối API</b> ở trên để hiển thị danh sách.
            </div>
          ) : (
            <>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                  <h4 className="font-bold text-gray-800">Danh sách Domain (Tên miền)</h4>
                  <button onClick={() => { setDomainFormData({ name: '' }); setShowDomainModal(true); }} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm font-bold rounded-lg hover:bg-orange-600 transition-colors">
                    + Thêm Domain mới
                  </button>
                </div>
                
                {posteLoading ? (
                  <div className="p-8 text-center text-gray-500">Đang tải...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3 font-semibold border-b border-gray-200">Tên miền (Domain)</th>
                          <th className="px-6 py-3 font-semibold border-b border-gray-200 text-right">Hành động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {posteDomains.length === 0 ? (
                          <tr><td colSpan={2} className="px-6 py-8 text-center text-gray-400">Không có Domain nào.</td></tr>
                        ) : posteDomains.map((domain, idx) => (
                          <tr key={idx} className="hover:bg-gray-50/50">
                            <td className="px-6 py-4">
                              <div className="font-mono text-sm font-bold text-gray-900">{domain.name}</div>
                            </td>
                            <td className="px-6 py-4 text-right space-x-2">
                              <button onClick={() => deleteDomain(domain.name)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                                Xóa
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Mailboxes List */}

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <h4 className="font-bold text-gray-800">Danh sách Hộp thư (Email Accounts)</h4>
                <button onClick={() => { setShowPassword(false); setPosteFormData({ name: '', email: '', passwordPlaintext: '', quota: 0 }); setShowPosteModal(true); }} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm font-bold rounded-lg hover:bg-emerald-600 transition-colors">
                  + Tạo Hộp thư mới
                </button>
              </div>
              
              {posteLoading ? (
                <div className="p-8 text-center text-gray-500">Đang đồng bộ dữ liệu từ Poste.io...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                        <th className="px-6 py-3 font-semibold border-b border-gray-200">Họ và tên</th>
                        <th className="px-6 py-3 font-semibold border-b border-gray-200">Địa chỉ Email</th>
                        <th className="px-6 py-3 font-semibold border-b border-gray-200">Trạng thái</th>
                        <th className="px-6 py-3 font-semibold border-b border-gray-200">Dung lượng</th>
                        <th className="px-6 py-3 font-semibold border-b border-gray-200 text-right">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {posteBoxes.length === 0 ? (
                        <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">Không tìm thấy hộp thư nào. Hoặc kết nối API thất bại.</td></tr>
                      ) : posteBoxes.map((box, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50">
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{box.name}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-gray-600 font-mono text-sm">{box.email || box.emailAddress || box.address || box.login || box.id || Object.keys(box).filter(k => k !== 'name' && k !== 'nameReal' && k !== 'disabled' && k !== 'quota' && k !== 'passwordPlaintext').map(k => box[k]).join(', ')}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${box.disabled ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                              {box.disabled ? 'Đã khóa' : 'Hoạt động'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-gray-900 text-sm font-semibold">
                              {box.quota ? `${box.quota} MB` : 'Không giới hạn'}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right space-x-2">
                            <button onClick={() => togglePosteBox(box.email, box.disabled ? 'Disabled' : 'Active')} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100">
                              {box.disabled ? 'Mở khóa' : 'Khóa'}
                            </button>
                            <button onClick={() => { setShowPassword(false); setPosteFormData({ name: box.name, email: box.email || box.emailAddress || box.address || box.login || box.id || '', passwordPlaintext: '', quota: box.quota || 0 }); setShowPosteModal(true); }} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-blue-600 hover:bg-blue-50">
                              Chỉnh sửa
                            </button>
                            <button onClick={() => deletePosteBox(box.email)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                              Xóa
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </>
          )}
        </div>
      </div>

      {/* Aliases List */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm mt-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-gray-600" />
            <h3 className="font-bold text-gray-700">Quản lý Nhóm Mail (Chuyển tiếp đa luồng)</h3>
          </div>
        </div>

        {!posteApiConfig.POSTE_API_URL || !posteApiConfig.POSTE_API_USER ? (
          <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-xl border border-gray-200 border-dashed">
            Vui lòng điền thông tin và bấm <b>Lưu & Kết nối API</b> ở trên để quản lý Alias.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h4 className="font-bold text-gray-800">Danh sách Nhóm Mail</h4>
              <button onClick={() => { setAliasFormData({ name: '', email: '', goto: '' }); setShowAliasModal(true); }} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white text-sm font-bold rounded-lg hover:bg-indigo-600 transition-colors">
                + Tạo Nhóm Mail mới
              </button>
            </div>
            
            {posteLoading ? (
              <div className="p-8 text-center text-gray-500">Đang tải...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-3 font-semibold border-b border-gray-200">Địa chỉ Email Nhóm</th>
                      <th className="px-6 py-3 font-semibold border-b border-gray-200">Các thành viên trong nhóm</th>
                      <th className="px-6 py-3 font-semibold border-b border-gray-200 text-right">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {posteAliases.length === 0 ? (
                      <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">Không có Nhóm Mail nào.</td></tr>
                    ) : posteAliases.map((alias, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50">
                        <td className="px-6 py-4">
                          <div className="font-mono text-sm font-bold text-indigo-600">{alias.email}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-gray-600 text-sm max-w-md truncate" title={alias.goto}>{alias.goto}</div>
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button onClick={() => { setAliasFormData({ name: alias.name || '', email: alias.email, goto: alias.goto }); setShowAliasModal(true); }} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-blue-600 hover:bg-blue-50">
                            Chỉnh sửa
                          </button>
                          <button onClick={() => deleteAlias(alias.email)} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showDomainModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-lg">Thêm Tên miền mới</h3>
              <button onClick={() => setShowDomainModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200">✕</button>
            </div>
            <form onSubmit={createDomain} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên miền (Domain)</label>
                <input required type="text" value={domainFormData.name} onChange={e => setDomainFormData({ name: e.target.value })} placeholder="tranlecorp.com.vn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                <p className="text-xs text-gray-500 mt-1.5">Ví dụ: tranlecorp.com.vn, tranlecorp.com</p>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowDomainModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors">Hủy</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600 transition-colors shadow-lg shadow-orange-200">Thêm mới</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPosteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-lg">
                {isBoxUpdateRender ? 'Cập nhật Mật khẩu' : 'Tạo Hộp thư mới'}
              </h3>
              <button onClick={() => setShowPosteModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200">
                ✕
              </button>
            </div>
            <form onSubmit={createOrUpdatePosteBox} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên hiển thị (Tên nhân viên)</label>
                <input required value={posteFormData.name} onChange={e => setPosteFormData(p => ({ ...p, name: e.target.value }))} placeholder="Nguyễn Văn A" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Địa chỉ Email</label>
                <input required type="email" value={posteFormData.email} readOnly={isBoxUpdateRender} onChange={e => setPosteFormData(p => ({ ...p, email: e.target.value }))} placeholder="nva@tranlecorp.com.vn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none read-only:bg-gray-100 read-only:text-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu (Plaintext)</label>
                <div className="relative">
                  <input required={!isBoxUpdateRender} type={showPassword ? "text" : "password"} value={posteFormData.passwordPlaintext} onChange={e => setPosteFormData(p => ({ ...p, passwordPlaintext: e.target.value }))} placeholder={isBoxUpdateRender ? "Bỏ trống để giữ nguyên mật khẩu cũ" : "Nhập mật khẩu cho email..."} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none pr-10" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">Mật khẩu sẽ được mã hóa an toàn khi lưu vào máy chủ Mail.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Dung lượng giới hạn (Quota MB)</label>
                <input type="number" value={posteFormData.quota} onChange={e => setPosteFormData(p => ({ ...p, quota: Number(e.target.value) }))} placeholder="0 = Không giới hạn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-200 outline-none" />
                <p className="text-xs text-gray-500 mt-1.5">Nhập số Megabytes (VD: 1024 cho 1GB). Nhập 0 để không giới hạn.</p>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowPosteModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors">Hủy</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition-colors shadow-lg shadow-blue-200">
                  {isBoxUpdateRender ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAliasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-lg">
                {isAliasUpdateRender ? 'Cập nhật Nhóm Mail' : 'Tạo Nhóm Mail mới'}
              </h3>
              <button onClick={() => setShowAliasModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200">✕</button>
            </div>
            <form onSubmit={createOrUpdateAlias} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Địa chỉ Email của Nhóm</label>
                <input required type="email" value={aliasFormData.email} readOnly={isAliasUpdateRender} onChange={e => setAliasFormData(p => ({ ...p, email: e.target.value }))} placeholder="nhom_du_an@tranlecorp.com.vn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-200 outline-none read-only:bg-gray-100 read-only:text-gray-500" />
                <p className="text-xs text-gray-500 mt-1.5">Ví dụ: sales@tranlecorp.com.vn, contact@tranlecorp.com.vn (không cần tạo hộp thư thật, mọi người trong nhóm sẽ nhận được mail gửi vào địa chỉ này).</p>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Thành viên trong Nhóm (Giao diện 2 cột)</label>
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Cột trái: Danh sách có sẵn */}
                  <div className="flex-1 border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex flex-col h-64">
                    <div className="bg-gray-100 p-2 text-xs font-bold text-gray-600 border-b border-gray-200 flex justify-between items-center">
                      <span>Email hệ thống</span>
                      <span className="bg-white px-2 py-0.5 rounded-full border border-gray-200">{posteBoxes.length}</span>
                    </div>
                    <div className="overflow-y-auto p-2 space-y-1 flex-1">
                      {posteBoxes.filter(b => !(aliasFormData.goto || '').includes(b.email || b.login)).map((box, i) => (
                        <div key={i} className="flex justify-between items-center bg-white p-2 rounded border border-gray-100 shadow-sm hover:border-indigo-300">
                          <span className="text-sm truncate mr-2" title={box.email || box.login}>{box.email || box.login}</span>
                          <button type="button" onClick={() => setAliasFormData(p => ({ ...p, goto: p.goto ? p.goto + ', ' + (box.email || box.login) : (box.email || box.login) }))} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded shrink-0">
                            + Thêm
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Icon giữa */}
                  <div className="flex items-center justify-center text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
                  </div>

                  {/* Cột phải: Đã chọn */}
                  <div className="flex-1 border border-indigo-200 rounded-xl overflow-hidden bg-indigo-50/30 flex flex-col h-64">
                    <div className="bg-indigo-100 p-2 text-xs font-bold text-indigo-700 border-b border-indigo-200 flex justify-between items-center">
                      <span>Thành viên đã chọn</span>
                      <span className="bg-white px-2 py-0.5 rounded-full text-indigo-600 border border-indigo-200">
                        {aliasFormData.goto.split(',').filter(x => x.trim()).length}
                      </span>
                    </div>
                    <div className="overflow-y-auto p-2 space-y-1 flex-1">
                      {aliasFormData.goto.split(',').map(e => e.trim()).filter(Boolean).map((email, i) => (
                        <div key={i} className="flex justify-between items-center bg-white p-2 rounded border border-indigo-100 shadow-sm">
                          <span className="text-sm truncate font-medium text-gray-800 mr-2" title={email}>{email}</span>
                          <button type="button" onClick={() => {
                            const arr = aliasFormData.goto.split(',').map(x => x.trim()).filter(Boolean);
                            setAliasFormData(p => ({ ...p, goto: arr.filter(x => x !== email).join(', ') }));
                          }} className="text-red-500 hover:bg-red-50 p-1 rounded shrink-0 font-bold">
                            ✕
                          </button>
                        </div>
                      ))}
                      <div className="pt-2 mt-2 border-t border-indigo-100">
                        <input type="email" placeholder="Nhập thêm email ngoài + Enter" className="w-full text-sm px-3 py-1.5 border border-indigo-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val && !aliasFormData.goto.includes(val)) {
                              setAliasFormData(p => ({ ...p, goto: p.goto ? p.goto + ', ' + val : val }));
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowAliasModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors">Hủy</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-500 text-white font-bold hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-200">
                  {isAliasUpdateRender ? 'Cập nhật Nhóm' : 'Tạo Nhóm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SMTP Configuration */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-gray-600" />
            <h3 className="font-bold text-gray-700">Cấu hình SMTP / Email Hệ Thống</h3>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200">
            <ShieldCheck size={12} /> Lưu trong hệ thống
          </span>
        </div>

        {smtpMessage && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium border ${smtpMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
            {smtpMessage.text}
          </div>
        )}

        {smtpLoading ? (
          <div className="py-8 text-center text-gray-400">Đang tải cấu hình SMTP...</div>
        ) : (
          <div className="space-y-6">
            
            {/* Server Config */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <h4 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Server size={16} className="text-blue-500" /> Cấu hình Máy chủ Mail (Dùng chung)
              </h4>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <span>Email Trần Lê: mail.tranlecorp.com.vn (IMAP SSL 993, SMTP SSL 465)</span>
                <button type="button" onClick={useTranleWebmailPreset} className="font-bold underline underline-offset-2 hover:text-blue-900">Dùng cấu hình này</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">IMAP Host (Nhận thư)</label>
                  <input value={smtpConfig.IMAP_HOST} onChange={(e) => handleSmtpChange('IMAP_HOST', e.target.value)} placeholder="mail.tranlecorp.com.vn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">IMAP Port</label>
                  <input value={smtpConfig.IMAP_PORT} onChange={(e) => handleSmtpChange('IMAP_PORT', e.target.value)} placeholder="993" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">SMTP Host (Gửi thư)</label>
                  <input value={smtpConfig.SMTP_HOST} onChange={(e) => handleSmtpChange('SMTP_HOST', e.target.value)} placeholder="mail.tranlecorp.com.vn" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">SMTP Port</label>
                  <input value={smtpConfig.SMTP_PORT} onChange={(e) => handleSmtpChange('SMTP_PORT', e.target.value)} placeholder="465" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">Kết nối bảo mật (SMTP Secure)</label>
                  <select value={smtpConfig.SMTP_SECURE} onChange={(e) => handleSmtpChange('SMTP_SECURE', e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none bg-white">
                    <option value="false">false (thường dùng với port 587)</option>
                    <option value="true">true (thường dùng với port 465)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* System Account Config */}
            <div className="bg-orange-50/50 border border-orange-100 rounded-xl p-5">
              <h4 className="text-sm font-bold text-gray-800 mb-1 flex items-center gap-2">
                <ShieldCheck size={16} className="text-orange-500" /> Tài khoản Email Hệ thống
              </h4>
              <p className="text-xs text-gray-500 mb-4">Tài khoản này dùng để hệ thống gửi các email thông báo tự động (quên mật khẩu, nhắc việc...)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email Hệ thống</label>
                  <input value={smtpConfig.SMTP_USER} onChange={(e) => handleSmtpChange('SMTP_USER', e.target.value)} placeholder="noreply@tranlecorp.com.vn" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu</label>
                  <input type="password" value={smtpConfig.SMTP_PASS} onChange={(e) => handleSmtpChange('SMTP_PASS', e.target.value)} placeholder="Nhập hoặc giữ nguyên mật khẩu đã lưu" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên hiển thị (SMTP From)</label>
                  <input value={smtpConfig.SMTP_FROM} onChange={(e) => handleSmtpChange('SMTP_FROM', e.target.value)} placeholder='Tran Le Tasks Hệ thống <noreply@tranlecorp.com.vn>' className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-700 mb-3">Test cấu hình SMTP</p>
              <div className="flex flex-col md:flex-row gap-3">
                <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Nhập email nhận thư test" className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-200 outline-none bg-white" />
                <button onClick={testSmtpConfig} disabled={smtpTesting} className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition-colors disabled:opacity-60">
                  <Save size={16} /> {smtpTesting ? 'Đang test...' : 'Test gửi mail'}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={saveSmtpConfig} disabled={smtpSaving} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-lg shadow-orange-200 hover:shadow-orange-300 transition-all disabled:opacity-60">
                <Save size={16} /> {smtpSaving ? 'Đang lưu...' : 'Lưu cấu hình SMTP'}
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.action}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
