import { apiFetch } from '../services/api';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { useAuth } from './AuthContext';
import { Bell, CheckCircle, AlertCircle, X, FileText, StickyNote } from 'lucide-react';
import { Note } from '../types';

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
  isRead: number; // 0 | 1
  createdAt: string;
}

export interface ToastOptions {
  type?: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  duration?: number; // ms, default 4000
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  setNotes: (notes: Note[]) => void;
  showToast: (opts: ToastOptions) => string;
  dismissToastById: (id: string) => void;
  pushLocalNotification: (notif: Omit<AppNotification, 'id' | 'isRead' | 'createdAt'>) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [simpleToasts, setSimpleToasts] = useState<(ToastOptions & { id: string })[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const navigate = useNavigate();
  const isFirstLoad = useRef(true);
  const prevIds = useRef<Set<string>>(new Set());
  const firedReminders = useRef<Set<string>>(new Set()); // note ids already reminded
  const isMailAuthFailed = useRef(false);

  const playSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // Bell chord: 3 harmonic notes played in sequence (ding - dong - ding)
      const notes = [
        { freq: 1046.50, delay: 0,    dur: 0.8 },  // C6
        { freq:  880.00, delay: 0.15, dur: 0.8 },  // A5
        { freq: 1318.51, delay: 0.30, dur: 1.0 },  // E6
      ];

      notes.forEach(({ freq, delay, dur }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        // Bell decay envelope
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + dur + 0.05);
      });
    } catch (e) {}
  };

  const dismissToast = (id: string) => setToasts(curr => curr.filter(t => t.id !== id));
  const dismissSimpleToast = (id: string) => setSimpleToasts(curr => curr.filter(t => t.id !== id));

  const showToast = (opts: ToastOptions): string => {
    const id = Math.random().toString(36).slice(2);
    setSimpleToasts(prev => [...prev, { ...opts, id }]);
    setTimeout(() => dismissSimpleToast(id), opts.duration ?? 4000);
    return id;
  };

  const dismissToastById = (id: string) => dismissSimpleToast(id);

  const pushLocalNotification = (notif: Omit<AppNotification, 'id' | 'isRead' | 'createdAt'>) => {
    const n: AppNotification = {
      ...notif,
      id: 'local-' + Math.random().toString(36).slice(2),
      isRead: 0,
      createdAt: new Date().toISOString(),
    };
    setNotifications(prev => [n, ...prev]);
    setToasts(prev => [...prev, n]);
    playSound();
    setTimeout(() => dismissToast(n.id), 5000);
  };

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/notifications/${user.id}`);
      if (res.ok) {
        const data: AppNotification[] = await res.json();
        
        if (!isFirstLoad.current) {
          const newNotifs = data.filter(n => !prevIds.current.has(n.id) && !n.isRead);
          if (newNotifs.length > 0) {
            playSound();
            setToasts(prev => [...prev, ...newNotifs]);
            newNotifs.forEach(n => {
              setTimeout(() => {
                dismissToast(n.id);
              }, 5000);
            });
          }
        } else {
          isFirstLoad.current = false;
        }
        
        prevIds.current = new Set(data.map(n => n.id));
        setNotifications(data);
      }
    } catch (e) {
      console.error('Failed to fetch notifications', e);
    }
  }, [user]);

  // Global mail polling
  useEffect(() => {
    if (!user) return;
    isMailAuthFailed.current = false;

    // Scan unread mail count on login
    const scanUnreadCount = async () => {
      if (isMailAuthFailed.current) return;
      try {
        const res = await apiFetch('/api/mail/unread-count');
        if (!res.ok) {
          if (res.status === 401) isMailAuthFailed.current = true;
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.count > 0) {
            pushLocalNotification({
              userId: user.id,
              type: 'new_mail',
              title: `📩 Hộp thư đến`,
              message: `Bạn có ${data.count} email chưa đọc.`
            });
            playSound();
          }
        }
      } catch (e) { }
    };
    scanUnreadCount();

    const checkNewMail = async () => {
      if (isMailAuthFailed.current) return;
      try {
        const res = await apiFetch('/api/mail/check-new');
        if (!res.ok) {
          if (res.status === 401) isMailAuthFailed.current = true;
          return;
        }
        const data = await res.json();
        if (data.uid && !data.isRead) {
          const lastSeenUid = localStorage.getItem(`last_mail_uid_${user.id}`);
          if (!lastSeenUid || parseInt(lastSeenUid, 10) < data.uid) {
            localStorage.setItem(`last_mail_uid_${user.id}`, data.uid.toString());

            // Push to bell notifications (persisted)
            pushLocalNotification({
              userId: user.id,
              type: 'mail_received',
              title: `📧 Email từ ${data.fromName || data.from || 'Ai đó'}`,
              message: data.subject || '(Không có tiêu đề)'
            });

            // Show toast popup
            showToast({
              type: 'info',
              title: `📩 Thư mới từ ${data.fromName || data.from || 'Ai đó'}`,
              message: data.subject || '(Không có tiêu đề)',
              duration: 6000,
            });

            playSound();
          }
        }
      } catch (e) { }
    };
    
    // Check shortly after login, then every 30s
    const timeout = setTimeout(checkNewMail, 5000);
    const interval = setInterval(checkNewMail, 30000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [user]);

  // Replace polling with Socket.io
  useEffect(() => {
    refresh(); // initial fetch

    if (!user) return;

    // Connect to socket
    const socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: {
        token: localStorage.getItem('tranle_token') || ''
      }
    });

    socket.on('new_notification', (data: AppNotification) => {
      
      setNotifications(prev => {
        // Prevent duplicate if already exists
        if (prev.some(n => n.id === data.id)) return prev;
        return [data, ...prev];
      });

      setToasts(prev => [...prev, data]);
      playSound();

      setTimeout(() => {
        dismissToast(data.id);
      }, 5000);
    });

    // Fallback slow poll just in case of disconnects
    const interval = setInterval(refresh, 5 * 60 * 1000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [user, refresh]);

  const markRead = async (id: string) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: 1 } : n));
  };

  const markAllRead = async () => {
    if (!user) return;
    await apiFetch(`/api/notifications/read-all/${user.id}`, { method: 'PATCH' });
    setNotifications(prev => prev.map(n => ({ ...n, isRead: 1 })));
  };

  const deleteNotification = async (id: string) => {
    await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' });
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, deleteNotification, refresh, setNotes, showToast, dismissToastById, pushLocalNotification }}>
      {children}
      
      {/* Toast Portal */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map(t => {
          const isReportReminder   = t.type === 'report_reminder';
          const isNoteReminder     = t.type === 'note_reminder';
          const isDailyTaskReminder = t.type === 'daily_task_reminder';
          return (
            <div
              key={t.id}
              onClick={() => {
                const typeLower = t.type?.toLowerCase() || '';
                const titleLower = t.title?.toLowerCase() || '';

                if (typeLower.includes('mail') || titleLower.includes('email') || titleLower.includes('thư')) {
                  navigate(t.relatedId ? `/mail?mailId=${t.relatedId}` : '/mail');
                } else if (typeLower.includes('contract') || titleLower.includes('hợp đồng') || titleLower.includes('hop dong')) {
                  navigate(t.relatedId ? `/contracts?contractId=${t.relatedId}` : '/contracts');
                } else if (typeLower.includes('project') || titleLower.includes('dự án') || titleLower.includes('du an')) {
                  navigate('/projects');
                } else if (typeLower.includes('report') || titleLower.includes('báo cáo') || titleLower.includes('bao cao')) {
                  navigate('/reports');
                } else if (typeLower.includes('task') || titleLower.includes('công việc') || titleLower.includes('cong viec')) {
                  navigate('/tasks');
                } else if (typeLower.includes('meeting') || titleLower.includes('họp') || titleLower.includes('hop')) {
                  navigate('/meetings');
                } else if (typeLower.includes('note') || titleLower.includes('ghi chú') || titleLower.includes('ghi chu')) {
                  navigate('/notes');
                }
                dismissToast(t.id);
              }}
              className={`cursor-pointer pointer-events-auto w-[340px] backdrop-blur-xl border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.18)] rounded-2xl p-4 flex items-start gap-3 animate-in slide-in-from-right-8 fade-in duration-300
                ${isReportReminder  ? 'bg-violet-600 border-violet-500/50 text-white'
                  : isNoteReminder   ? 'bg-amber-50 border-amber-200 text-gray-800'
                  : isDailyTaskReminder ? 'bg-blue-600 border-blue-500/50 text-white'
                  : 'bg-white/95 border-gray-100 text-gray-800'}
              `}
            >
              <div className={`p-2.5 rounded-xl flex-shrink-0 shadow-sm
                ${isReportReminder ? 'bg-white/20'
                  : isNoteReminder  ? 'bg-amber-400'
                  : isDailyTaskReminder ? 'bg-white/20'
                  : 'bg-blue-50 border border-blue-100/50'}
              `}>
                <Bell size={20} className={
                  isReportReminder   ? 'text-white animate-[wiggle_1s_ease-in-out_infinite]'
                  : isNoteReminder    ? 'text-white animate-[wiggle_1s_ease-in-out_infinite]'
                  : isDailyTaskReminder ? 'text-white animate-[wiggle_1s_ease-in-out_infinite]'
                  : 'text-blue-600 animate-[wiggle_1s_ease-in-out_infinite]'
                }/>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className={`text-sm font-bold truncate ${isReportReminder ? 'text-white' : isNoteReminder ? 'text-amber-900' : 'text-gray-800'}`}>{t.title}</h4>
                <p className={`text-xs line-clamp-2 mt-1 leading-relaxed ${isReportReminder ? 'text-violet-200' : isNoteReminder ? 'text-amber-700' : 'text-gray-500'}`}>{t.message}</p>
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${isReportReminder ? 'hover:bg-white/20 text-violet-200' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
              >
                <X size={16}/>
              </button>
            </div>
          );
        })}
      </div>

      {/* Simple Toast Portal (success / error / info) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 items-center pointer-events-none">
        {simpleToasts.map(t => {
          const isSuccess = t.type === 'success';
          const isError = t.type === 'error';
          const isWarning = t.type === 'warning';
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-xl animate-in slide-in-from-bottom-4 fade-in duration-300 min-w-[280px] max-w-[480px]
                ${
                  isSuccess ? 'bg-emerald-600 border-emerald-500/50 text-white'
                  : isError ? 'bg-red-600 border-red-500/50 text-white'
                  : isWarning ? 'bg-amber-500 border-amber-400/50 text-white'
                  : 'bg-gray-900 border-gray-700 text-white'
                }`}
            >
              <div className={`p-2 rounded-xl flex-shrink-0 ${
                isSuccess || isError || isWarning ? 'bg-white/20' : 'bg-white/10'
              }`}>
                {isSuccess ? <CheckCircle size={20} className="text-white" /> :
                 isError ? <AlertCircle size={20} className="text-white" /> :
                 <Bell size={20} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{t.title}</p>
                {t.message && <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{t.message}</p>}
              </div>

              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick();
                    dismissSimpleToast(t.id);
                  }}
                  className="px-3 py-1.5 ml-2 text-xs font-bold bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex-shrink-0 shadow-sm"
                >
                  {t.action.label}
                </button>
              )}

              <button
                onClick={() => dismissSimpleToast(t.id)}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex-shrink-0 ml-1"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
};

