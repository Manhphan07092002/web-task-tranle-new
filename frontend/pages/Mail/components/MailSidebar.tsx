import React, { useState, useRef, useEffect } from 'react';
import { Mail, RefreshCw, MailOpen, Users, Edit3, Inbox, Send, Star, Trash2, Search, Filter, MailX } from 'lucide-react';
import { Email, FolderKey } from '../types';
import { groupThreads, groupEmailsByDate, Avatar, formatDate } from '../utils';
import Flatpickr from 'react-flatpickr';
import { toLocalDateString } from '../../../utils/dateUtils';

interface MailSidebarProps {
  userEmail: string;
  inbox: Email[];
  filtered: Email[];
  activeFolder: FolderKey;
  isLoading: boolean;
  selectedThread: Email[] | null;
  selectedUids: Set<number>;
  selectAllInMailbox: boolean;
  search: string;
  filterUnread: boolean;
  filterStarred: boolean;
  filterDateFrom: string;
  filterDateTo: string;
  hasMore: boolean;
  
  onSearchChange: (val: string) => void;
  onFilterUnreadChange: (val: boolean) => void;
  onFilterStarredChange: (val: boolean) => void;
  onFilterDateFromChange: (val: string) => void;
  onFilterDateToChange: (val: string) => void;
  onClearFilters: () => void;
  
  onSwitchFolder: (f: FolderKey) => void;
  onRefresh: () => void;
  onShowTrackingStats: () => void;
  onShowContacts: () => void;
  onOpenCompose: () => void;
  
  onToggleSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectAllInMailbox: (val: boolean) => void;
  onToggleSelectMail: (id: number, e: React.MouseEvent) => void;
  onBulkAction: (action: 'delete' | 'restore') => void;
  isBulkActioning: boolean;
  
  onReadThread: (thread: Email[]) => void;
  onToggleStar: (email: Email, e: React.MouseEvent) => void;
  onToggleRead: (email: Email, e: React.MouseEvent) => void;
  onDeleteMail: (email: Email, e: React.MouseEvent) => void;
  onLoadMore: () => void;

  onOpenDraft: (draft: any) => void;
  onDeleteDraft: () => void;
}

export default function MailSidebar(props: MailSidebarProps) {
  const {
    userEmail, inbox, filtered, activeFolder, isLoading, selectedThread, selectedUids, selectAllInMailbox,
    search, filterUnread, filterStarred, filterDateFrom, filterDateTo, hasMore,
    onSearchChange, onFilterUnreadChange, onFilterStarredChange, onFilterDateFromChange, onFilterDateToChange, onClearFilters,
    onSwitchFolder, onRefresh, onShowTrackingStats, onShowContacts, onOpenCompose,
    onToggleSelectAll, onDeselectAll, onSelectAllInMailbox, onToggleSelectMail, onBulkAction, isBulkActioning,
    onReadThread, onToggleStar, onToggleRead, onDeleteMail, onLoadMore,
    onOpenDraft, onDeleteDraft
  } = props;

  const [showDateFilter, setShowDateFilter] = useState(false);
  const dateFilterRef = useRef<HTMLDivElement>(null);

  // Close date filter dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateFilterRef.current && !dateFilterRef.current.contains(e.target as Node)) {
        setShowDateFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = inbox.filter(m => !m.isRead).length;

  return (
    <div className="w-[400px] flex-shrink-0 border-r border-gray-100 flex flex-col bg-gray-50/50">
      {/* Compact header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-white flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Mail size={15} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800 leading-tight">Hộp Thư</p>
            <p className="text-[10px] text-gray-400 truncate max-w-[130px]">{userEmail}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onRefresh} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors" title="Làm mới">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onShowTrackingStats} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-amber-600 transition-colors" title="Thống kê email">
            <MailOpen size={14} />
          </button>
          <button onClick={onShowContacts} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-indigo-600 transition-colors" title="Danh bạ công ty">
            <Users size={14} />
          </button>
          <button onClick={onOpenCompose} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors shadow-sm">
            <Edit3 size={12} /> Soạn thư
          </button>
        </div>
      </div>

      {/* Folder tabs */}
      <div className="flex border-b border-gray-100 bg-white">
        {([
          { key: 'inbox', label: 'Hộp đến', icon: Inbox },
          { key: 'sent', label: 'Đã gửi', icon: Send },
          { key: 'drafts', label: 'Nháp', icon: Edit3 },
          { key: 'starred', label: 'Sao', icon: Star },
          { key: 'trash', label: 'Thùng rác', icon: Trash2 },
        ] as { key: FolderKey; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onSwitchFolder(key)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors border-b-2
            ${activeFolder === key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Search + Filters or Bulk Actions */}
      <div className="p-3 border-b border-gray-100 space-y-2 min-h-[85px] flex flex-col justify-center">
        {(selectedUids.size > 0 || selectAllInMailbox) ? (
          <div className="space-y-1.5 animate-fade-in">
            <div className="flex items-center justify-between bg-blue-50/80 p-2 rounded-lg border border-blue-200 shadow-sm">
              <span className="text-xs font-bold text-blue-700 px-1">
                {selectAllInMailbox ? `Đã chọn tất cả trong hộp thư` : `Đã chọn ${selectedUids.size}`}
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={onDeselectAll} className="px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-200 rounded transition-colors">Bỏ chọn</button>
                {activeFolder === 'trash' && (
                  <button onClick={() => onBulkAction('restore')} disabled={isBulkActioning} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded transition-colors disabled:opacity-50 shadow-sm">
                    <RefreshCw size={12} className={isBulkActioning ? 'animate-spin' : ''} /> Khôi phục
                  </button>
                )}
                <button onClick={() => onBulkAction('delete')} disabled={isBulkActioning} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded transition-colors disabled:opacity-50 shadow-sm">
                  <Trash2 size={12} /> {activeFolder === 'trash' ? 'Xóa vĩnh viễn' : 'Xóa'}
                </button>
              </div>
            </div>
            {!selectAllInMailbox && selectedUids.size === inbox.length && inbox.length > 0 && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700">
                <span className="flex-1">Đã chọn {inbox.length} thư đang hiển thị. Muốn chọn toàn bộ hộp thư?</span>
                <button onClick={() => onSelectAllInMailbox(true)} className="font-bold text-blue-600 hover:text-blue-800 whitespace-nowrap underline">Chọn tất cả</button>
              </div>
            )}
          </div>
        ) : (
          <div className="relative animate-fade-in">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm kiếm email..."
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-blue-400 transition-colors"
            />
          </div>
        )}

        {/* Quick filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onToggleSelectAll}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors border ${selectAllInMailbox || (selectedUids.size > 0 && selectedUids.size === inbox.length && inbox.length > 0)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
              }`}
          >
            <div className={`w-3 h-3 rounded-[3px] border flex items-center justify-center transition-colors ${selectAllInMailbox || (selectedUids.size > 0 && selectedUids.size === inbox.length && inbox.length > 0) ? 'border-white' : 'border-gray-400'}`}>
              {(selectAllInMailbox || (selectedUids.size > 0 && selectedUids.size === inbox.length && inbox.length > 0)) &&
                <svg viewBox="0 0 14 14" fill="none" className="w-2.5 h-2.5 text-current"><path d="M3 7.5L5.5 10L11 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </div>
            Chọn trang này ({inbox.length})
          </button>
          <div className="w-px h-3 bg-gray-200 mx-1" />
          <button onClick={() => onFilterUnreadChange(!filterUnread)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border ${filterUnread ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}>
            <MailOpen size={10} /> Chưa đọc
          </button>
          <button onClick={() => onFilterStarredChange(!filterStarred)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border ${filterStarred ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'}`}>
            <Star size={10} /> Có sao
          </button>
          
          <div className="relative" ref={dateFilterRef}>
            <button
              onClick={() => setShowDateFilter(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors border ${filterDateFrom || filterDateTo ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'}`}
            >
              <Filter size={10} />
              {filterDateFrom || filterDateTo ? (
                <span>
                  {filterDateFrom ? new Date(filterDateFrom).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '...'}
                  {' – '}
                  {filterDateTo ? new Date(filterDateTo).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '...'}
                </span>
              ) : 'Ngày'}
            </button>

            {showDateFilter && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-64 animate-fade-in">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Lọc theo khoảng ngày</p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1 font-medium">Từ ngày</label>
                    <Flatpickr
                      value={filterDateFrom ? new Date(filterDateFrom) : ''}
                      onChange={([date]) => onFilterDateFromChange(date ? toLocalDateString(date) : '')}
                      options={{ dateFormat: 'd/m/Y', maxDate: filterDateTo || undefined }}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400 bg-gray-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1 font-medium">Đến ngày</label>
                    <Flatpickr
                      value={filterDateTo ? new Date(filterDateTo) : ''}
                      onChange={([date]) => onFilterDateToChange(date ? toLocalDateString(date) : '')}
                      options={{ dateFormat: 'd/m/Y', minDate: filterDateFrom || undefined }}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400 bg-gray-50"
                    />
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-gray-100">
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Chọn nhanh</p>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { label: 'Hôm nay', fn: () => { const t = new Date().toISOString().slice(0, 10); onFilterDateFromChange(t); onFilterDateToChange(t); } },
                      { label: 'Hôm qua', fn: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = d.toISOString().slice(0, 10); onFilterDateFromChange(s); onFilterDateToChange(s); } },
                      { label: '7 ngày qua', fn: () => { const d = new Date(); d.setDate(d.getDate() - 6); onFilterDateFromChange(d.toISOString().slice(0, 10)); onFilterDateToChange(new Date().toISOString().slice(0, 10)); } },
                      { label: 'Tháng này', fn: () => { const now = new Date(); onFilterDateFromChange(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)); onFilterDateToChange(now.toISOString().slice(0, 10)); } },
                    ].map(({ label, fn }) => (
                      <button key={label} onClick={() => { fn(); setShowDateFilter(false); }} className="px-2 py-1.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-left">{label}</button>
                    ))}
                  </div>
                </div>
                {(filterDateFrom || filterDateTo) && (
                  <button onClick={() => { onFilterDateFromChange(''); onFilterDateToChange(''); setShowDateFilter(false); }} className="mt-2 w-full py-1.5 text-[10px] font-semibold text-red-500 hover:bg-red-50 rounded-lg border border-red-200">
                    Xóa bộ lọc ngày
                  </button>
                )}
              </div>
            )}
          </div>

          {(filterUnread || filterStarred || filterDateFrom || filterDateTo) && (
            <button onClick={onClearFilters} className="px-2 py-1 rounded-md text-[10px] text-gray-400 hover:text-red-500 border border-gray-200 transition-colors">
              Xóa lọc
            </button>
          )}
          <span className="ml-auto text-[10px] text-gray-400">{filtered.length} thư{unreadCount > 0 ? ` • ${unreadCount} chưa đọc` : ''}</span>
        </div>
      </div>

      {/* Mail list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeFolder === 'drafts' ? (
          (() => {
            const draftStr = localStorage.getItem('mail_draft');
            const draft = draftStr ? (() => { try { return JSON.parse(draftStr); } catch { return null; } })() : null;
            return draft && (draft.to || draft.subject || draft.body) ? (
              <div className="p-3">
                <div onClick={() => onOpenDraft(draft)} className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 cursor-pointer transition-colors group">
                  <div className="w-8 h-8 rounded-lg bg-amber-200 text-amber-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Edit3 size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold text-amber-800 truncate">{draft.subject || '(Không có tiêu đề)'}</span>
                      <button onClick={e => { e.stopPropagation(); onDeleteDraft(); }} className="p-1 rounded text-amber-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all ml-2 flex-shrink-0" title="Xóa nháp">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p className="text-[11px] text-amber-700 truncate">Đến: {draft.to || '(chưa có người nhận)'}</p>
                    <p className="text-[10px] text-amber-500 mt-0.5 line-clamp-1">
                      {draft.body?.replace(/<[^>]*>/g, ' ').trim() || '(Nội dung trống)'}
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 text-center mt-3">Bấm để tiếp tục soạn thư nháp</p>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400 text-sm">
                <Edit3 size={32} className="opacity-30 mx-auto mb-2" />
                Không có thư nháp nào.
              </div>
            );
          })()
        ) : isLoading && inbox.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <RefreshCw className="animate-spin mx-auto mb-2" size={20} />
            Đang tải hộp thư...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <Mail size={32} className="opacity-30 mx-auto mb-2" />
            Không có email nào.
          </div>
        ) : (
          groupEmailsByDate(groupThreads(filtered).map(t => ({ representative: t[0], thread: t }))).map(group => (
            <div key={group.label}>
              <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-gray-50/80 border-b border-gray-100 sticky top-0 z-10">
                {group.label}
              </div>
              {group.items.map(({ representative: email, thread }) => {
                const isSelected = selectedThread && selectedThread[0].id === email.id;
                const displayName = activeFolder === 'sent'
                  ? (email.toName || email.to || 'Không rõ')
                  : (email.fromName || email.from);
                const isRead = thread.every(m => m.isRead);
                return (
                  <div key={email.id} onClick={() => onReadThread(thread)} className={`relative flex gap-2.5 p-3.5 cursor-pointer transition-all border-b border-gray-100/80 group ${isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : isRead ? 'hover:bg-gray-50' : 'bg-white border-l-2 border-l-blue-400 hover:bg-blue-50/30'}`}>
                    <div className="flex flex-col items-center pt-1" onClick={e => onToggleSelectMail(email.id, e)}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${selectedUids.has(email.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white group-hover:border-blue-400'}`}>
                        {selectedUids.has(email.id) && <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3 text-white"><path d="M3 7.5L5.5 10L11 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </div>
                    </div>
                    <Avatar name={displayName} size={9} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs truncate max-w-[200px] ${!isRead ? 'font-bold text-gray-900' : 'font-medium text-gray-600'}`}>
                          {displayName} {thread.length > 1 && <span className="text-gray-400 font-normal ml-1">({thread.length})</span>}
                        </span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap ml-1">{formatDate(email.date)}</span>
                      </div>
                      <p className={`text-xs truncate ${!isRead ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>
                        {email.subject || '(Không có tiêu đề)'}
                      </p>
                    </div>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-white/90 rounded-lg shadow-sm px-1">
                      <button onClick={e => onToggleStar(email, e)} className={`p-1 rounded transition-colors ${email.isStarred ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`} title={email.isStarred ? 'Bỏ sao' : 'Gắn sao'}>
                        <Star size={13} fill={email.isStarred ? 'currentColor' : 'none'} />
                      </button>
                      <button onClick={e => onToggleRead(email, e)} className={`p-1 rounded transition-colors ${email.isRead ? 'text-gray-300 hover:text-blue-500' : 'text-blue-400 hover:text-gray-400'}`} title={email.isRead ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}>
                        {email.isRead ? <MailX size={13} /> : <MailOpen size={13} />}
                      </button>
                      {activeFolder !== 'trash' && (
                        <button onClick={e => onDeleteMail(email, e)} className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors" title="Xoá">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {!isRead && !email.isStarred && <span className="absolute right-3 top-3 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 group-hover:hidden" />}
                    {email.isStarred && <Star size={11} className="absolute right-3 top-3 text-amber-400 fill-amber-400 group-hover:hidden" />}
                  </div>
                );
              })}
            </div>
          ))
        )}

        {/* Load more button */}
        {!isLoading && inbox.length > 0 && hasMore && search === '' && activeFolder !== 'drafts' && (
          <div className="p-4 flex justify-center border-t border-gray-100">
            <button
              onClick={onLoadMore}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50 hover:text-blue-600 transition-colors shadow-sm"
            >
              Tải thêm email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
