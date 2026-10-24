import React, { useState, useRef, useEffect } from 'react';
import { Menu, Globe, Search, X, Bell, Mail, MailOpen, CheckSquare, FileText, Clock, StickyNote, CalendarDays, Send, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNotifications, AppNotification } from '../../contexts/NotificationContext';

const getGreeting = (t: (key: string) => string) => {
  const hour = new Date().getHours();
  if (hour < 12) return t('goodMorning');
  if (hour < 18) return t('goodAfternoon');
  return t('goodEvening');
};

const LiveClock = () => {
  const [time, setTime] = useState(new Date());
  const { language } = useLanguage();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const locale = language === 'vi' ? 'vi-VN' : 'en-US';

  return (
    <div className="hidden xl:flex flex-col items-end mr-4 border-r border-gray-200 pr-4">
      <div className="text-lg font-bold text-gray-800 font-mono leading-none tabular-nums">
        {time.toLocaleTimeString(locale, { hour12: false })}
      </div>
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
        {time.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
    </div>
  );
};

const fmtRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
};

const getNotifIcon = (type: string, title: string) => {
  const t = (type + title).toLowerCase();
  if (t.includes('mail_sent') || t.includes('gửi'))    return { icon: <Send size={16}/>,       bg: 'bg-green-100',  color: 'text-green-600'  };
  if (t.includes('mail') || t.includes('thư') || t.includes('email')) return { icon: <MailOpen size={16}/>, bg: 'bg-blue-100',   color: 'text-blue-600'   };
  if (t.includes('stock_alert') || t.includes('cảnh báo tồn')) return { icon: <AlertTriangle size={16}/>, bg: 'bg-red-100', color: 'text-red-600' };
  if (t.includes('report') || t.includes('báo cáo')) return { icon: <FileText size={16}/>,    bg: 'bg-amber-100',  color: 'text-amber-600'  };
  if (t.includes('task') || t.includes('công việc')) return { icon: <CheckSquare size={16}/>, bg: 'bg-indigo-100', color: 'text-indigo-600' };
  if (t.includes('meeting') || t.includes('họp'))    return { icon: <CalendarDays size={16}/>,bg: 'bg-purple-100', color: 'text-purple-600' };
  if (t.includes('note') || t.includes('ghi chú'))   return { icon: <StickyNote size={16}/>,  bg: 'bg-yellow-100', color: 'text-yellow-600' };
  return                                              { icon: <Bell size={16}/>,           bg: 'bg-gray-100',   color: 'text-gray-500'   };
};

const NotificationItem: React.FC<{ n: AppNotification; onClick: () => void; onDelete: () => void }> = ({ n, onClick, onDelete }) => {
  const { icon, bg, color } = getNotifIcon(n.type, n.title);
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer group ${!n.isRead ? 'bg-blue-50/50' : ''}`}
      onClick={onClick}
    >
      {/* Icon */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${bg} ${color} flex-shrink-0 mt-0.5`}>
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
          {n.title}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
        <p className="text-[10px] text-gray-400 mt-1 font-medium">{fmtRelative(n.createdAt)}</p>
      </div>

      {/* Unread dot */}
      {!n.isRead && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}

      {/* Delete */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="p-1 rounded-full hover:bg-red-100 text-transparent group-hover:text-gray-300 hover:!text-red-500 transition-colors flex-shrink-0 mt-0.5"
        title="Xóa thông báo"
      >
        <X size={12} />
      </button>
    </div>
  );
};

interface TopHeaderProps {
  setIsMobileMenuOpen: (o: boolean) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  notification: any;
  setNotification: (n: any) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  setIsMobileMenuOpen, searchQuery, setSearchQuery,
}) => {
  const { user } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead, deleteNotification } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  const handleNotificationClick = (n: AppNotification) => {
    if (!n.isRead) markRead(n.id);
    setOpen(false);
    
    const typeLower = n.type?.toLowerCase() || '';
    const titleLower = n.title?.toLowerCase() || '';

    if (typeLower.includes('stock_alert') || titleLower.includes('cảnh báo tồn')) {
      const warehouseId = n.relatedId?.startsWith('stock-alert:') ? n.relatedId.slice('stock-alert:'.length) : '';
      navigate(`/dept/warehouse?m=wh_alerts${warehouseId ? `&warehouseId=${encodeURIComponent(warehouseId)}` : ''}`);
    } else if (typeLower.includes('mail') || titleLower.includes('email') || titleLower.includes('thư')) {
      navigate(n.relatedId ? `/mail?mailId=${n.relatedId}` : '/mail');
    } else if (typeLower.includes('contract') || titleLower.includes('hợp đồng') || titleLower.includes('hop dong')) {
      navigate(n.relatedId ? `/contracts?contractId=${n.relatedId}` : '/contracts');
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
    } else {
      navigate('/');
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-focus mobile search input when opened
  useEffect(() => {
    if (mobileSearchOpen && mobileSearchRef.current) {
      mobileSearchRef.current.focus();
    }
  }, [mobileSearchOpen]);

  const toggleLanguage = () => setLanguage(language === 'vi' ? 'en' : 'vi');

  const getPageTitle = () => {
    if (location.pathname === '/') return `${getGreeting(t)}, ${user?.name.split(' ')[0]}`;
    const name = location.pathname.split('/')[1];
    return t(name);
  };

  return (
    <>
      <header className="h-16 sm:h-20 mt-2 sm:mt-4 mx-2 sm:mx-4 lg:ml-6 lg:mr-8 bg-white/60 backdrop-blur-2xl border border-white/50 shadow-sm rounded-2xl sm:rounded-3xl flex items-center justify-between px-3 sm:px-6 shrink-0 z-30 transition-all">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="lg:hidden p-2 hover:bg-gray-100 rounded-lg text-gray-600 flex-shrink-0"
          >
            <Menu size={20} />
          </button>

          {/* Sleek Page Navigation Buttons (Back & Forward) */}
          <div className="hidden sm:flex items-center gap-1 bg-gray-100/60 p-1 rounded-xl border border-gray-200/40 shadow-sm backdrop-blur-md">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 hover:bg-white text-gray-500 hover:text-brand-600 hover:shadow-sm rounded-lg transition-all duration-200 active:scale-90 flex items-center justify-center"
              title="Quay lại (Back)"
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => navigate(1)}
              className="p-1.5 hover:bg-white text-gray-500 hover:text-brand-600 hover:shadow-sm rounded-lg transition-all duration-200 active:scale-90 flex items-center justify-center"
              title="Tiến lên (Forward)"
            >
              <ChevronRight size={16} strokeWidth={2.5} />
            </button>
          </div>

          <h1 className="text-base sm:text-xl font-bold text-gray-800 capitalize hidden sm:block truncate">
            {getPageTitle()}
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 md:gap-6 flex-shrink-0">
          <LiveClock />

          {/* Language toggle — icon-only on mobile, full on md+ */}
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-2 p-2 md:px-3 md:py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-sm font-medium text-gray-700"
            title={language === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
          >
            <Globe size={16} className="text-gray-500" />
            <span className="hidden md:inline">{language === 'vi' ? 'Tiếng Việt' : 'English'}</span>
          </button>

          {/* Desktop search bar */}
          <div className="hidden md:flex items-center bg-gray-100 rounded-full px-4 py-2 w-64 focus-within:ring-2 focus-within:ring-brand-200 transition-all">
            <Search size={18} className="text-gray-400" />
            <input
              type="text"
              placeholder={t('search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-sm ml-2 w-full placeholder-gray-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Mobile search icon button */}
          <button
            onClick={() => setMobileSearchOpen(true)}
            className="md:hidden p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
            aria-label="Tìm kiếm"
          >
            <Search size={20} />
          </button>

          {/* ── Notification Bell ── */}
          <div className="relative" ref={panelRef}>
            <button
              className="relative p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
              onClick={() => setOpen(v => !v)}
              aria-label="Thông báo"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse border-2 border-white leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {open && (
              <div className="notification-dropdown absolute right-0 sm:right-0 top-14 w-[calc(100vw-2rem)] sm:w-96 max-w-[400px] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 animate-in slide-in-from-top-2 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                  <div className="flex items-center gap-2">
                    <Bell size={16} className="text-gray-600" />
                    <span className="font-semibold text-gray-800 text-sm">Thông báo</span>
                    {unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                    >
                      Đọc tất cả
                    </button>
                  )}
                </div>

                {/* Notification list */}
                <div className="max-h-[60vh] sm:max-h-[420px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <Bell size={36} strokeWidth={1.2} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium">Không có thông báo nào</p>
                      <p className="text-xs mt-1">Các thông báo sẽ xuất hiện ở đây</p>
                    </div>
                  ) : (
                    notifications.map(n => (
                      <NotificationItem
                        key={n.id}
                        n={n}
                        onClick={() => handleNotificationClick(n)}
                        onDelete={() => deleteNotification(n.id)}
                      />
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-1.5">
                  <button
                    onClick={() => { setOpen(false); navigate('/notifications'); }}
                    className="w-full text-center text-sm font-semibold text-brand-600 hover:text-brand-700 bg-white hover:bg-brand-50 py-2 rounded-xl transition-colors shadow-sm border border-brand-100"
                  >
                    Xem tất cả thông báo
                  </button>
                  {notifications.length > 0 && (
                    <button
                      onClick={() => notifications.forEach(n => deleteNotification(n.id))}
                      className="w-full text-center text-xs text-gray-400 hover:text-red-500 py-1 transition-colors"
                    >
                      Xóa tất cả thông báo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile Search Overlay ── */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileSearchOpen(false)} />
          <div className="mobile-search-overlay relative mx-2 mt-2 p-3 bg-white rounded-2xl shadow-2xl border border-gray-200 flex items-center gap-3">
            <Search size={20} className="text-gray-400 flex-shrink-0" />
            <input
              ref={mobileSearchRef}
              type="text"
              placeholder={t('search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-base placeholder-gray-400"
            />
            <button
              onClick={() => { setMobileSearchOpen(false); }}
              className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500 flex-shrink-0"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
