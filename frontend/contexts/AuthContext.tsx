import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { User } from '../types';

const LOGIN_API_URL = '/api/auth/login';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;

  logout: () => void;
  isLoading: boolean;
  updateUserSession: (updatedUser: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to decode JWT without a library
function parseJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('tranle_token');
    const storedUser = localStorage.getItem('tranle_user');
    
    if (token && storedUser) {
      const payload = parseJwt(token);
      if (payload && payload.exp && payload.exp * 1000 > Date.now()) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          localStorage.removeItem('tranle_user');
          localStorage.removeItem('tranle_token');
        }
        // Làm mới quyền/level từ server (đổi role có hiệu lực không cần đăng nhập lại).
        // Thất bại thì giữ session cũ; 401 thì xóa (token bị revoke).
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          .then(async (res) => {
            if (res.status === 401) {
              localStorage.removeItem('tranle_token');
              localStorage.removeItem('tranle_user');
              setUser(null);
              return;
            }
            if (!res.ok) return;
            const data = await res.json().catch(() => ({}));
            if (data?.user) {
              setUser(data.user);
              localStorage.setItem('tranle_user', JSON.stringify(data.user));
            }
          })
          .catch(() => {})
          .finally(() => setIsLoading(false));
        return;
      } else {
        localStorage.removeItem('tranle_token');
        localStorage.removeItem('tranle_user');
      }
    } else {
      localStorage.removeItem('tranle_token');
      localStorage.removeItem('tranle_user');
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(LOGIN_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: data.error || 'Email hoặc mật khẩu không đúng. Vui lòng thử lại.' };
      }
      setUser(data.user);
      localStorage.setItem('tranle_token', data.token);
      localStorage.setItem('tranle_user', JSON.stringify(data.user));
      return { success: true };
    } catch (e) {
      console.error('Login failed:', e);
      return { success: false, error: 'Đã xảy ra lỗi kết nối. Vui lòng thử lại.' };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('tranle_token');
    localStorage.removeItem('tranle_user');
  };



  const updateUserSession = (updatedUser: User) => {
    setUser(updatedUser);
    localStorage.setItem('tranle_user', JSON.stringify(updatedUser));
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading, updateUserSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
