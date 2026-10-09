import { apiFetch } from '../../services/api';

import React, { useState, useEffect } from 'react';
import { User, Bell, Moon, Sun, Lock, Shield, Save, CheckCircle, Camera, Globe, Eye, EyeOff, AlertTriangle, Mail, Wifi, WifiOff, RefreshCw, Unlink, Monitor } from 'lucide-react';
import { Button, Card, Avatar } from "../../components/UI";
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import Flatpickr from 'react-flatpickr';
import { toLocalDateString } from '../../utils/dateUtils';
import { useMailConnectionCooldown } from '../../hooks/useMailConnectionCooldown';

export const SettingsView: React.FC = () => {
  const { t } = useLanguage();
  const { user, updateUserSession } = useAuth();
  const { saveUser } = useData();
  const [activeTab, setActiveTab] = useState('profile');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Profile State
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [hometown, setHometown] = useState('');
  const [cccd, setCccd] = useState('');
  const [gender, setGender] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Notifications
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [taskNotifs, setTaskNotifs] = useState(true);
  const [reportNotifs, setReportNotifs] = useState(true);
  const [meetingNotifs, setMeetingNotifs] = useState(true);

  // Appearance
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // Mail config state
  const [mailEmail, setMailEmail] = useState('');
  const [mailPassword, setMailPassword] = useState('');
  const [showMailPw, setShowMailPw] = useState(false);
  const [mailStatus, setMailStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
  const [isCheckingMail, setIsCheckingMail] = useState(false);
  const { retryAfterSeconds, applyCooldown } = useMailConnectionCooldown();
  const [mailError, setMailError] = useState('');
  const [mailSuccess, setMailSuccess] = useState('');
  const [mailProvider, setMailProvider] = useState<'webmail' | 'poste' | 'custom'>('webmail');
  const [customImapHost, setCustomImapHost] = useState('');
  const [customImapPort, setCustomImapPort] = useState('993');
  const [customSmtpHost, setCustomSmtpHost] = useState('');
  const [customSmtpPort, setCustomSmtpPort] = useState('587');

  useEffect(() => {
    if (user) {
      setName(user.name);
      setAvatarUrl(user.avatar || '');
      setBio(user.bio || '');
      setPhone(user.phone || '');
      setDob(user.dob || '');
      setHometown(user.hometown || '');
      setCccd(user.cccd || '');
      setGender(user.gender || '');
      setMailEmail(user.email || '');
      
      if (user.preferences) {
        setEmailNotifs(user.preferences.emailNotifs ?? true);
        setTaskNotifs(user.preferences.taskNotifs ?? true);
        setReportNotifs(user.preferences.reportNotifs ?? true);
        setMeetingNotifs(user.preferences.meetingNotifs ?? true);
        setLanguage(user.preferences.language || 'vi');
        setTheme(user.preferences.theme || 'system');
      }
    }
  }, [user]);

  // Check mail connection status and active provider on mount
  useEffect(() => {
    apiFetch('/api/mail/unread-count')
      .then(r => setMailStatus(r.ok ? 'connected' : 'error'))
      .catch(() => setMailStatus('error'));

    apiFetch('/api/mail/provider')
      .then(r => {
        if (r.ok) return r.json();
        throw new Error();
      })
      .then(data => {
        if (data && data.provider) {
          const mappedProvider = data.provider === 'poste' || data.provider === 'custom' ? data.provider : 'webmail';
          setMailProvider(mappedProvider);
          if (data.imapHost) setCustomImapHost(data.imapHost);
          if (data.smtpHost) setCustomSmtpHost(data.smtpHost);
        }
      })
      .catch(() => {
        setMailProvider('webmail'); // Fallback
      });
  }, []);

  if (!user) return null;

  const showSaveSuccess = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleSaveProfile = async () => {
    try {
      const updatedUser = { ...user, name, avatar: avatarUrl, bio, phone, dob, hometown, cccd, gender };
      await saveUser(updatedUser);
      updateUserSession(updatedUser);
      showSaveSuccess();
    } catch (e) {
      alert('Lưu hồ sơ thất bại, vui lòng thử lại.');
    }
  };

  const handleSavePreferences = async () => {
    try {
      const updatedUser = {
        ...user,
        preferences: {
          ...user.preferences,
          emailNotifs,
          taskNotifs,
          reportNotifs,
          meetingNotifs,
          language,
          theme
        }
      };
      await saveUser(updatedUser);
      updateUserSession(updatedUser);
      showSaveSuccess();
    } catch (e) {
      alert('Lưu cài đặt thất bại, vui lòng thử lại.');
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 800 * 1024) { alert('Ảnh quá lớn! Tối đa 800KB.'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSavePassword = async () => {
    setPwError('');
    setPwSuccess('');
    if (!currentPassword) { setPwError('Vui lòng nhập mật khẩu hiện tại.'); return; }
    if (newPassword.length < 6) { setPwError('Mật khẩu mới phải có ít nhất 6 ký tự.'); return; }
    if (newPassword !== confirmPassword) { setPwError('Mật khẩu xác nhận không khớp.'); return; }

    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(data.error || 'Đổi mật khẩu thất bại.');
        return;
      }

      setPwSuccess('Đổi mật khẩu thành công!');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setTimeout(() => setPwSuccess(''), 3000);
    } catch {
      setPwError('Đổi mật khẩu thất bại.');
    }
  };

  const TABS = [
    { id: 'profile',       label: 'Hồ sơ của tôi',  icon: User },
    { id: 'notifications', label: 'Thông báo',        icon: Bell },
    { id: 'appearance',    label: 'Giao diện',        icon: Moon },
    { id: 'security',      label: 'Bảo mật',          icon: Lock },
    { id: 'mail',          label: 'Cấu hình Email',   icon: Mail },
  ];

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-blue-500' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'profile':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Avatar */}
            <div className="flex items-center gap-6 pb-6 border-b border-gray-100">
              <div className="relative group">
                <Avatar src={avatarUrl || user.avatar} alt={name} size={20} />
                <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <Camera size={18} className="text-white" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </label>
              </div>
              <div>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-4 py-2 rounded-lg transition-colors mb-1">
                    <Camera size={14} /> Đổi ảnh đại diện
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </label>
                <p className="text-xs text-gray-500 mt-1">JPG, GIF hoặc PNG. Tối đa 800KB</p>
              </div>
            </div>

            {/* Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Họ và tên</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Số điện thoại</label>
                <input
                  type="text"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Ví dụ: 0987654321"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Ngày sinh</label>
                <Flatpickr
                  value={dob ? new Date(dob) : ''}
                  onChange={([date]) => setDob(date ? toLocalDateString(date) : '')}
                  options={{ dateFormat: 'd/m/Y' }}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all text-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Quê quán</label>
                <input
                  type="text"
                  value={hometown}
                  onChange={e => setHometown(e.target.value)}
                  placeholder="Ví dụ: Hà Nội"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all text-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">CCCD / ID Card</label>
                <input
                  type="text"
                  value={cccd}
                  onChange={e => setCccd(e.target.value)}
                  placeholder="Nhập số CCCD"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all text-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Giới tính</label>
                <select
                  value={gender}
                  onChange={e => setGender(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all text-gray-700 bg-white"
                >
                  <option value="">Chọn giới tính</option>
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Phòng ban</label>
                <input defaultValue={user.department} disabled className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input defaultValue={user.email} disabled className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Vai trò</label>
                <input defaultValue={user.role} disabled className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Giới thiệu bản thân</label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                rows={3}
                placeholder="Viết vài dòng về bản thân..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm resize-none transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              {saveSuccess && (
                <span className="text-sm text-green-600 flex items-center gap-1.5">
                  <CheckCircle size={15} /> Đã lưu thành công!
                </span>
              )}
              <button
                onClick={handleSaveProfile}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
              >
                <Save size={15} /> Lưu thay đổi
              </button>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Thông báo Email</h3>
              {[
                { label: 'Báo cáo cần duyệt', desc: 'Nhận email khi có báo cáo chờ phê duyệt', checked: reportNotifs, onChange: setReportNotifs },
                { label: 'Công việc được giao', desc: 'Nhận email khi được giao thêm công việc mới', checked: taskNotifs, onChange: setTaskNotifs },
                { label: 'Nhắc nhở cuộc họp', desc: 'Nhận email 30 phút trước khi cuộc họp bắt đầu', checked: meetingNotifs, onChange: setMeetingNotifs },
                { label: 'Tổng kết hàng ngày', desc: 'Nhận tóm tắt công việc mỗi sáng', checked: emailNotifs, onChange: setEmailNotifs },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                  <Toggle checked={item.checked} onChange={item.onChange} />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSavePreferences}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
              >
                <Save size={15} /> Lưu cài đặt
              </button>
            </div>
            {saveSuccess && <p className="text-sm text-green-600 text-right flex items-center justify-end gap-1.5"><CheckCircle size={15}/> Đã lưu!</p>}
          </div>
        );

      case 'appearance':
        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            {/* Theme Selection */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sun size={16} /> Chế độ hiển thị
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { value: 'light', label: 'Sáng', icon: <Sun size={20} /> },
                  { value: 'dark', label: 'Tối', icon: <Moon size={20} /> },
                  { value: 'system', label: 'Hệ thống', icon: <Monitor size={20} /> },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value as 'light' | 'dark' | 'system')}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${theme === opt.value ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-100 bg-white text-gray-500 hover:border-blue-200 hover:bg-gray-50'}`}
                  >
                    <div className="mb-2">{opt.icon}</div>
                    <span className="text-sm font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Language Selection */}
            <div className="border-t border-gray-100 pt-6">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe size={16} /> Ngôn ngữ hệ thống
              </h3>
              <div className="flex gap-4">
                {[
                  { value: 'vi', label: '🇻🇳 Tiếng Việt', desc: 'Ngôn ngữ chính' },
                  { value: 'en', label: '🇺🇸 English', desc: 'Secondary Language' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setLanguage(opt.value as 'vi' | 'en')}
                    className={`flex-1 flex flex-col items-start p-4 rounded-xl border-2 transition-all ${language === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:border-blue-200'}`}
                  >
                    <span className={`text-sm font-bold ${language === opt.value ? 'text-blue-700' : 'text-gray-700'}`}>{opt.label}</span>
                    <span className="text-xs text-gray-500 mt-1">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Account Info (Moved to bottom, styled nicely) */}
            <div className="border-t border-gray-100 pt-6">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Thông tin tài khoản</h3>
              <div className="bg-gray-50/50 rounded-2xl p-5 border border-gray-100">
                <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                  <div>
                    <span className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">ID Hệ thống</span>
                    <span className="font-mono text-gray-800 bg-white px-2 py-1 rounded shadow-sm border border-gray-100">{user.id}</span>
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Email đăng nhập</span>
                    <span className="text-gray-800 font-medium">{user.email}</span>
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Phòng ban</span>
                    <span className="text-gray-800">{user.department}</span>
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Vai trò</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {user.role}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="border-t border-gray-100 pt-6 flex justify-end">
              <button
                onClick={handleSavePreferences}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
              >
                <Save size={16} /> Lưu cấu hình giao diện
              </button>
            </div>
            {saveSuccess && <p className="text-sm text-green-600 text-right flex items-center justify-end gap-1.5"><CheckCircle size={15}/> Cập nhật thành công!</p>}
          </div>
        );

      case 'security':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div>
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Đổi mật khẩu</h3>
              <div className="space-y-4 max-w-md">
                {[
                  { label: 'Mật khẩu hiện tại', value: currentPassword, onChange: setCurrentPassword, show: showCurrentPw, toggle: setShowCurrentPw },
                  { label: 'Mật khẩu mới', value: newPassword, onChange: setNewPassword, show: showNewPw, toggle: setShowNewPw },
                  { label: 'Xác nhận mật khẩu mới', value: confirmPassword, onChange: setConfirmPassword, show: showNewPw, toggle: setShowNewPw },
                ].map(field => (
                  <div key={field.label}>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{field.label}</label>
                    <div className="relative">
                      <input
                        type={field.show ? 'text' : 'password'}
                        value={field.value}
                        onChange={e => field.onChange(e.target.value)}
                        className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 outline-none text-sm"
                      />
                      <button type="button" onClick={() => field.toggle(!field.show)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                        {field.show ? <EyeOff size={16}/> : <Eye size={16}/>}
                      </button>
                    </div>
                  </div>
                ))}

                {pwError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
                    <AlertTriangle size={14}/> {pwError}
                  </div>
                )}
                {pwSuccess && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-xl px-4 py-2.5">
                    <CheckCircle size={14}/> {pwSuccess}
                  </div>
                )}

                <button
                  onClick={handleSavePassword}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                >
                  <Shield size={15}/> Cập nhật mật khẩu
                </button>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Phiên đăng nhập</h3>
              <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">Thiết bị hiện tại</p>
                  <p className="text-xs text-gray-500 mt-0.5">Trình duyệt Web · {new Date().toLocaleDateString('vi-VN')}</p>
                </div>
                <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">Đang hoạt động</span>
              </div>
            </div>
          </div>
        );

      case 'mail':
        let providerLabel = 'Email Trần Lê';
        if (mailProvider === 'poste') providerLabel = 'Poste.io';
        else if (mailProvider === 'custom') providerLabel = 'Tùy chỉnh';

        const providerHelpLink = mailProvider === 'poste' ? 'mail.tranlecorp.com.vn' : mailProvider === 'custom' ? 'IT support' : 'share-mail05.nhanhoa.com:2096';
        const emailPlaceholder = mailProvider === 'poste' ? 'vd: ten.nhanvien@tranlecorp.com.vn' : mailProvider === 'custom' ? 'vd: ten@domain.com' : 'vd: ten.nhanvien@tranlecorp.com.vn';
        const passwordPlaceholder = mailStatus === 'connected' ? '(giữ nguyên nếu không đổi)' : `Nhập mật khẩu email ${providerLabel}...`;
        const helpDescription = mailProvider === 'poste' 
          ? 'Email hộp thư Poste.io của bạn (ví dụ: email được cấp theo tên miền công ty)' 
          : mailProvider === 'custom' 
          ? 'Cấu hình kết nối Email tùy chỉnh (Gmail, Outlook, ...)' 
          : 'Email hộp thư mặc định của hệ thống';

        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Connection status banner */}
            <div className={`flex items-center gap-3 p-4 rounded-xl border ${
              mailStatus === 'connected'
                ? 'bg-green-50 border-green-200'
                : mailStatus === 'error'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                mailStatus === 'connected' ? 'bg-green-100' : mailStatus === 'error' ? 'bg-red-100' : 'bg-gray-100'
              }`}>
                {mailStatus === 'connected'
                  ? <Wifi size={18} className="text-green-600" />
                  : mailStatus === 'error'
                    ? <WifiOff size={18} className="text-red-500" />
                    : <RefreshCw size={18} className="text-gray-400" />}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-semibold ${
                  mailStatus === 'connected' ? 'text-green-700' : mailStatus === 'error' ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {mailStatus === 'connected' ? '✅ Email đang kết nối' : mailStatus === 'error' ? '❌ Chưa kết nối được email' : 'Đang kiểm tra...'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {mailStatus === 'connected'
                    ? `Hộp thư ${providerLabel} đang hoạt động bình thường.`
                    : mailStatus === 'error'
                      ? `Kiểm tra cấu hình và thông tin hộp thư ${providerLabel} để kết nối lại.`
                      : 'Đang kiểm tra trạng thái kết nối...'}
                </p>
              </div>
              {mailStatus === 'connected' && (
                <button
                  onClick={async () => {
                    if (!confirm(`Ngắt kết nối email ${providerLabel}? Bạn sẽ không nhận/gửi được thư cho đến khi kết nối lại.`)) return;
                    await apiFetch('/api/mail/disconnect', { method: 'POST' });
                    setMailStatus('error');
                    setMailPassword('');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Unlink size={13} /> Ngắt kết nối
                </button>
              )}
            </div>

            {/* Config form */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Cấu hình Tài khoản Email</h3>
              <div className="space-y-4 max-w-md">

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Loại tài khoản</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                    onClick={() => setMailProvider('webmail')}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${mailProvider === 'webmail' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >Email Trần Lê</button>
                    <button
                      type="button"
                      onClick={() => setMailProvider('poste')}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${mailProvider === 'poste' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >Poste.io</button>
                    <button
                      type="button"
                      onClick={() => setMailProvider('custom')}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${mailProvider === 'custom' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >Tùy chỉnh</button>
                  </div>
                </div>

                {mailProvider === 'custom' && (
                  <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">IMAP Host</label>
                      <input type="text" value={customImapHost} onChange={e => setCustomImapHost(e.target.value)} placeholder="imap.gmail.com" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">IMAP Port</label>
                      <input type="text" value={customImapPort} onChange={e => setCustomImapPort(e.target.value)} placeholder="993" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">SMTP Host</label>
                      <input type="text" value={customSmtpHost} onChange={e => setCustomSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">SMTP Port</label>
                      <input type="text" value={customSmtpPort} onChange={e => setCustomSmtpPort(e.target.value)} placeholder="587" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Địa chỉ Email</label>
                  <input
                    type="email"
                    value={mailEmail}
                    onChange={e => setMailEmail(e.target.value)}
                    placeholder={emailPlaceholder}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none text-sm transition-all"
                  />
                  <p className="text-xs text-gray-400 mt-1">{helpDescription}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Mật khẩu Email {providerLabel}</label>
                  <div className="relative">
                    <input
                      type={showMailPw ? 'text' : 'password'}
                      value={mailPassword}
                      onChange={e => setMailPassword(e.target.value)}
                      placeholder={mailStatus === 'connected' ? passwordPlaceholder : `Nhập mật khẩu email ${providerLabel}...`}
                      className="w-full px-4 py-2.5 pr-10 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-400 outline-none text-sm"
                    />
                    <button type="button" onClick={() => setShowMailPw(v => !v)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                      {showMailPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Mật khẩu được mã hóa và lưu an toàn trên máy chủ</p>
                </div>

                {mailError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
                    <WifiOff size={14} /> {mailError}
                  </div>
                )}
                {mailSuccess && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-xl px-4 py-2.5">
                    <CheckCircle size={14} /> {mailSuccess}
                  </div>
                )}

                <button
                  onClick={async () => {
                    if (isCheckingMail || retryAfterSeconds > 0) return;
                    if (!mailEmail || !mailPassword) { setMailError('Vui lòng nhập đầy đủ email và mật khẩu.'); return; }
                    setIsCheckingMail(true);
                    setMailError('');
                    setMailSuccess('');
                    try {
                      const res = await apiFetch('/api/mail/connect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          email: mailEmail, 
                          password: mailPassword,
                          provider: mailProvider,
                          customImapHost,
                          customImapPort,
                          customSmtpHost,
                          customSmtpPort
                        }),
                      });
                      if (res.ok) {
                        setMailStatus('connected');
                        setMailSuccess('Kết nối thành công! Đã lưu cấu hình hộp thư.');
                        setMailPassword('');
                        setTimeout(() => setMailSuccess(''), 4000);
                      } else {
                        const err = await res.json().catch(() => ({}));
                        applyCooldown(res, err);
                        setMailError(err.error || 'Không thể kết nối email. Vui lòng thử lại sau.');
                        setMailStatus('error');
                      }
                    } catch {
                      setMailError(`Không thể kết nối đến máy chủ ${providerLabel}. Vui lòng thử lại.`);
                      setMailStatus('error');
                    } finally {
                      setIsCheckingMail(false);
                    }
                  }}
                  disabled={isCheckingMail || retryAfterSeconds > 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                >
                  {isCheckingMail ? <RefreshCw size={15} className="animate-spin" /> : <Wifi size={15} />}
                  {isCheckingMail ? 'Đang kết nối...' : retryAfterSeconds > 0 ? `Thử lại sau ${retryAfterSeconds} giây` : mailStatus === 'connected' ? 'Cập nhật mật khẩu' : `Kết nối Email ${providerLabel}`}
                </button>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-700 mb-2">ℹ️ Hướng dẫn lấy mật khẩu Email {providerLabel}</p>
              <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
                <li>Đăng nhập vào <strong>{providerHelpLink}</strong> hoặc liên hệ IT để lấy mật khẩu email.</li>
                <li>Mật khẩu email {providerLabel} có thể <strong>khác</strong> mật khẩu đăng nhập hệ thống Tran Le Tasks.</li>
                <li>Nếu quên mật khẩu, liên hệ bộ phận IT hoặc Admin để được cấp lại.</li>
              </ul>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Cài đặt</h2>
        <p className="text-gray-500 text-sm mt-1">Quản lý hồ sơ và tuỳ chỉnh trải nghiệm của bạn</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <Card className="w-full lg:w-56 h-fit p-2 shrink-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all mb-1
                ${activeTab === tab.id
                  ? 'bg-blue-50 text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}
              `}
            >
              <tab.icon size={17} />
              {tab.label}
            </button>
          ))}
        </Card>

        {/* Main Content */}
        <Card className="flex-1 p-7 min-h-[480px]">
          <div className="mb-6 pb-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">{TABS.find(t => t.id === activeTab)?.label}</h3>
          </div>
          {renderContent()}
        </Card>
      </div>
    </div>
  );
};
