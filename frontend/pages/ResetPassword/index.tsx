import { apiFetch } from '../../services/api';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, KeyRound } from 'lucide-react';
import { Button, Input } from '../../components/UI';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setError('Link đặt lại mật khẩu không hợp lệ.');
        setChecking(false);
        return;
      }
      try {
        const res = await apiFetch(`/api/auth/reset-password/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || 'Link đặt lại mật khẩu không hợp lệ.');
          setIsValid(false);
        } else {
          setExpiresAt(data.expiresAt || '');
          setIsValid(true);
        }
      } catch {
        setError('Không thể xác thực link đặt lại mật khẩu.');
      } finally {
        setChecking(false);
      }
    };

    verifyToken();
  }, [token]);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Không thể đặt lại mật khẩu.');
      } else {
        setSuccess('Đặt lại mật khẩu thành công. Anh có thể quay về đăng nhập bằng mật khẩu mới.');
      }
    } catch {
      setError('Không thể đặt lại mật khẩu.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8 bg-transparent relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-br from-brand-300/40 to-rose-300/40 blur-[100px] -z-10 mix-blend-multiply pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[35vw] h-[35vw] rounded-full bg-gradient-to-tr from-brand-400/30 to-orange-400/30 blur-[100px] -z-10 mix-blend-multiply pointer-events-none" />

      <div className="w-full max-w-md mx-auto relative animate-in fade-in duration-500">
        <div className="bg-white/70 backdrop-blur-3xl rounded-[2.5rem] shadow-2xl shadow-gray-200/50 border border-white p-8 sm:p-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />

          <div className="flex items-center gap-3 mb-6 relative">
            <div className="p-3 rounded-2xl bg-brand-50 text-brand-600">
              <KeyRound size={22} />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900">Đặt lại mật khẩu</h2>
              <p className="text-sm text-gray-500">Tạo mật khẩu mới cho tài khoản của anh.</p>
            </div>
          </div>

          {checking ? (
            <div className="text-sm text-gray-400">Đang kiểm tra link đặt lại mật khẩu...</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 relative">
              {error && (
                <div className="p-4 bg-red-50/80 backdrop-blur-sm border border-red-100 text-red-600 text-sm rounded-2xl flex items-center gap-3">
                  <AlertCircle size={18} />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {success && (
                <div className="p-4 bg-emerald-50/80 backdrop-blur-sm border border-emerald-100 text-emerald-600 text-sm rounded-2xl flex items-center gap-3">
                  <CheckCircle2 size={18} />
                  <span className="font-medium">{success}</span>
                </div>
              )}

              {isValid && !success && (
                <>
                  {secondsLeft !== null && (
                    <div className="p-3 rounded-2xl bg-amber-50 border border-amber-100 text-amber-700 text-sm flex items-center gap-2">
                      <Clock3 size={16} />
                      <span>
                        Link sẽ hết hạn sau <strong>{Math.floor(secondsLeft / 60)} phút {secondsLeft % 60} giây</strong>
                      </span>
                    </div>
                  )}
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-slate-600 text-xs">
                    Nếu link hết hạn, anh cần yêu cầu tạo lại link mới từ trang quên mật khẩu.
                  </div>
                  <Input label="Mật khẩu mới" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nhập mật khẩu mới" />
                  <Input label="Xác nhận mật khẩu mới" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Nhập lại mật khẩu mới" />
                  <Button type="submit" className="w-full py-4 text-base font-extrabold tracking-wide" size="lg" disabled={submitting}>
                    {submitting ? 'Đang cập nhật...' : 'Đặt lại mật khẩu'}
                  </Button>
                </>
              )}
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-gray-200/50">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-orange-500 hover:text-orange-600">
              <ArrowLeft size={16} />
              Quay lại đăng nhập
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
