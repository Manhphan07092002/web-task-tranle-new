import React, { useState, useMemo } from 'react';
import { useNotifications } from '../../contexts/NotificationContext';
import { Bell, FileText, CheckCircle2, Clock, Trash2, CheckCircle, Search, LayoutList, CheckSquare, MailOpen, Send, StickyNote, CalendarDays, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, deleteNotification, refresh } = useNotifications();
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleNotificationClick = async (n: any) => {
    if (!n.isRead) await markRead(n.id);
    
    // Logic to navigate to specific item
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
    }
  };

  const handleDeleteAllRead = async () => {
    const readNotifs = notifications.filter(n => n.isRead);
    for (const n of readNotifs) {
      await deleteNotification(n.id);
    }
  };

  const displayedNotifs = useMemo(() => {
    let result = notifications;
    if (activeTab === 'unread') result = result.filter(n => !n.isRead);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q));
    }
    // Sort newest first
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [notifications, activeTab, searchQuery]);

  const getIconForType = (type: string, title: string) => {
    const t = (type + title).toLowerCase();
    if (t.includes('mail_sent') || t.includes('gửi'))           return <div className="p-2.5 bg-green-100 text-green-600 rounded-xl"><Send size={20}/></div>;
    if (t.includes('mail') || t.includes('thư') || t.includes('email')) return <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl"><MailOpen size={20}/></div>;
    if (t.includes('stock_alert') || t.includes('cảnh báo tồn')) return <div className="p-2.5 bg-red-100 text-red-600 rounded-xl"><AlertTriangle size={20}/></div>;
    if (type === 'daily_task_reminder')                          return <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl"><CheckSquare size={20}/></div>;
    if (t.includes('report') || t.includes('báo cáo'))        return <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl"><FileText size={20}/></div>;
    if (t.includes('task') || t.includes('công việc'))        return <div className="p-2.5 bg-indigo-100 text-indigo-600 rounded-xl"><CheckSquare size={20}/></div>;
    if (t.includes('meeting') || t.includes('họp'))           return <div className="p-2.5 bg-purple-100 text-purple-600 rounded-xl"><CalendarDays size={20}/></div>;
    if (t.includes('note') || t.includes('ghi chú'))          return <div className="p-2.5 bg-yellow-100 text-yellow-600 rounded-xl"><StickyNote size={20}/></div>;
    return                                                       <div className="p-2.5 bg-gray-100 text-gray-500 rounded-xl"><Bell size={20}/></div>;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 h-full flex flex-col min-h-0">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bell size={24} className="text-brand-500"/> Trung tâm Thông báo
          </h2>
          <p className="text-gray-500 text-sm mt-1">Quản lý và xem lại tất cả các thông báo hệ thống</p>
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-xl transition-colors shadow-sm border border-brand-100">
              <CheckCircle2 size={16}/> Đánh dấu tất cả đã đọc
            </button>
          )}
          <button onClick={handleDeleteAllRead} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors shadow-sm border border-red-100">
            <Trash2 size={16}/> Xóa đã đọc
          </button>
        </div>
      </div>

      {/* FILTER & TABS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-2">
        <div className="flex gap-2">
          <button 
            className={`py-2 px-4 text-sm font-bold rounded-lg transition-colors ${activeTab === 'all' ? 'bg-gray-100 text-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            onClick={() => setActiveTab('all')}
          >
            Tất cả
          </button>
          <button 
            className={`py-2 px-4 text-sm font-bold rounded-lg transition-colors flex items-center gap-1.5 ${activeTab === 'unread' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            onClick={() => setActiveTab('unread')}
          >
            Chưa đọc
            {unreadCount > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
          </button>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Tìm thông báo..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 transition-shadow bg-white hover:bg-gray-50 focus:bg-white shadow-sm"
          />
        </div>
      </div>

      {/* NOTIFICATION LIST */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3 pb-6">
        {displayedNotifs.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-gray-300">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 mb-4">
              <CheckCircle size={32} className="text-gray-300" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Bạn đã đọc hết thông báo!</h3>
            <p className="text-gray-500 text-sm">Không có thông báo nào {activeTab === 'unread' ? 'chưa đọc' : ''} ở đây.</p>
          </div>
        ) : (
          displayedNotifs.map(n => (
            <div 
              key={n.id} 
              onClick={() => handleNotificationClick(n)}
              className={`flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer group ${!n.isRead ? 'bg-white border-brand-200 shadow-md ring-1 ring-brand-100/50 hover:shadow-lg' : 'bg-gray-50/50 border-gray-100 shadow-sm hover:border-gray-200 hover:bg-white'}`}
            >
              <div className="flex-shrink-0 relative">
                {getIconForType(n.type, n.title)}
                {!n.isRead && <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></div>}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 mb-1">
                  <h4 className={`text-base font-bold truncate ${!n.isRead ? 'text-gray-900' : 'text-gray-700'}`}>{n.title}</h4>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
                      <Clock size={12}/>
                      {new Date(n.createdAt).toLocaleDateString('vi-VN')} {new Date(n.createdAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'})}
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }} 
                      className="text-gray-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Xóa thông báo"
                    >
                      <Trash2 size={16}/>
                    </button>
                  </div>
                </div>
                <p className={`text-sm ${!n.isRead ? 'text-gray-600' : 'text-gray-500'} line-clamp-2 leading-relaxed`}>{n.message}</p>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
