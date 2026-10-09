import React, { useState } from 'react';
import { Mail, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { apiFetch } from '../../../services/api';
import { useMailConnectionCooldown } from '../../../hooks/useMailConnectionCooldown';

interface ConnectScreenProps {
  onSuccess: () => void;
}

export default function ConnectScreen({ onSuccess }: ConnectScreenProps) {
  const { user } = useAuth();
  const [loginEmail, setLoginEmail] = useState(user?.email || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const { retryAfterSeconds, applyCooldown } = useMailConnectionCooldown();

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnecting || retryAfterSeconds > 0) return;
    setIsConnecting(true);
    setLoginError('');
    try {
      const res = await apiFetch('/api/mail/connect', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword, provider: 'webmail' })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        applyCooldown(res, err);
        throw new Error(err.error || 'Không thể kết nối email. Vui lòng thử lại sau.');
      }
      setLoginPassword('');
      onSuccess();
    } catch (err: any) {
      setLoginError(err.message || 'Không thể kết nối email. Vui lòng kiểm tra đường truyền và thử lại.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f0f4ff 0%,#faf0ff 100%)' }}>
      <div className="bg-white/90 backdrop-blur-xl p-10 rounded-3xl border border-gray-100 shadow-2xl max-w-md w-full">
        {/* Icon */}
        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg ${loginError ? 'bg-gradient-to-br from-red-400 to-rose-500 shadow-red-200' : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-200'}`}>
          {loginError ? <WifiOff size={36} className="text-white" /> : <Mail size={36} className="text-white" />}
        </div>
        <h2 className="text-2xl font-extrabold text-center text-gray-900 mb-1">
          {loginError ? 'Lỗi Kết Nối Email' : 'Kết nối Hộp Thư'}
        </h2>
        <p className="text-center text-gray-400 mb-8 text-sm leading-relaxed">
          {loginError
            ? <span className="text-red-500 font-medium">{loginError}</span>
            : <>Nhập mật khẩu hòm thư <span className="font-semibold text-blue-600">{loginEmail}</span><br />để đồng bộ Email Trần Lê của bạn.</>
          }
        </p>

        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email</label>
            <input
              type="email" required value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none text-sm transition-colors bg-gray-50 focus:bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Mật khẩu Email</label>
            <input
              type="password" required value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none text-sm transition-colors bg-gray-50 focus:bg-white ${loginError ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'}`}
              placeholder="••••••••••••"
            />
          </div>

          {loginError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              <WifiOff size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Kết nối chưa thành công</p>
                <p className="text-xs text-red-400 mt-0.5">{loginError}</p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting || retryAfterSeconds > 0}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isConnecting ? <RefreshCw className="animate-spin" size={18} /> : <Wifi size={18} />}
            {isConnecting ? 'Đang kết nối...' : retryAfterSeconds > 0 ? `Thử lại sau ${retryAfterSeconds} giây` : 'Kết Nối Email Trần Lê'}
          </button>
        </form>

        <div className="mt-5 pt-5 border-t border-gray-100 flex items-center justify-center gap-2">
          <span className="text-xs text-gray-400">Hoặc cấu hình trong</span>
          <a
            href="/settings"
            onClick={e => { e.preventDefault(); window.location.hash = ''; window.history.pushState({}, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2 flex items-center gap-1"
          >
            ⚙️ Cài đặt → Cấu hình Email
          </a>
        </div>
      </div>
    </div>
  );
}
