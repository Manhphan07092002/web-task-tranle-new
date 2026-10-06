import React, { useState, useEffect, useRef } from 'react';
import { Edit3, ChevronDown, X, Paperclip, Send, RefreshCw, Bold, Italic, Underline, Link, Trash2 } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { useNotifications } from '../../../contexts/NotificationContext';
import { useAuth } from '../../../contexts/AuthContext';

import Flatpickr from 'react-flatpickr';
import { toLocalDatetimeString } from '../../../utils/dateUtils';
import { avatarColor } from '../utils';
import DOMPurify from 'dompurify';

interface ComposeData {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

interface ComposeModalProps {
  initialData: ComposeData;
  onClose: (draftData?: ComposeData) => void;
  onDiscard: () => void;
  onSendSuccess: (msg: string, subject: string, to: string) => void;
}

export default function ComposeModal({ initialData, onClose, onDiscard, onSendSuccess }: ComposeModalProps) {
  const { user } = useAuth();
  const { showToast } = useNotifications();

  const [composeTo, setComposeTo] = useState(initialData.to);
  const [composeCc, setComposeCc] = useState(initialData.cc);
  const [composeBcc, setComposeBcc] = useState(initialData.bcc);
  const [showCc, setShowCc] = useState(!!initialData.cc);
  const [showBcc, setShowBcc] = useState(!!initialData.bcc);
  const [composeSubject, setComposeSubject] = useState(initialData.subject);
  const [composeBody, setComposeBody] = useState(() => DOMPurify.sanitize(initialData.body));
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  
  const [isSending, setIsSending] = useState(false);
  const [trackOpens, setTrackOpens] = useState(true);
  const [scheduleAt, setScheduleAt] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  const [allRecipients, setAllRecipients] = useState<{ email: string; name: string; count: number }[]>([]);
  const [suggestions, setSuggestions] = useState<{ email: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);

  // Focus body if empty or has just signature
  useEffect(() => {
    if (bodyRef.current && bodyRef.current.innerHTML !== composeBody) {
      bodyRef.current.innerHTML = DOMPurify.sanitize(composeBody);
    }
  }, [composeBody]);

  // Sync to local state silently every time it changes
  useEffect(() => {
    localStorage.setItem('mail_draft', JSON.stringify({
      to: composeTo, cc: composeCc, bcc: composeBcc,
      subject: composeSubject, body: composeBody
    }));
  }, [composeTo, composeCc, composeBcc, composeSubject, composeBody]);

  // Prevent accidentally closing the tab if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const signatureStripped = composeBody.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim();
      const hasContent = composeTo.trim() || composeSubject.trim() || signatureStripped;
      if (hasContent) {
        e.preventDefault();
        e.returnValue = ''; // Standard for most browsers to show a prompt
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [composeTo, composeSubject, composeBody]);

  // Fetch recipient suggestions
  useEffect(() => {
    apiFetch('/api/mail/recipients').then(r => r.ok ? r.json() : []).then(data => {
      setAllRecipients(data || []);
    }).catch(() => { });
  }, []);

  // Update suggestions when composeTo changes
  useEffect(() => {
    if (!composeTo) { setSuggestions([]); setShowSuggestions(false); return; }
    const parts = composeTo.split(',');
    const query = parts[parts.length - 1].trim().toLowerCase();
    if (query.length < 1) { setSuggestions([]); setShowSuggestions(false); return; }
    const filtered = allRecipients
      .filter(r => r.email.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
      .slice(0, 6);
    setSuggestions(filtered);
    setSuggestionIdx(-1);
    setShowSuggestions(filtered.length > 0);
  }, [composeTo, allRecipients]);

  const pickSuggestion = (email: string) => {
    const parts = composeTo.split(',');
    parts[parts.length - 1] = ' ' + email;
    const newVal = parts.join(',').replace(/^,\s*/, '') + ', ';
    setComposeTo(newVal.trimStart());
    setSuggestions([]);
    setShowSuggestions(false);
    setSuggestionIdx(-1);
    setTimeout(() => toInputRef.current?.focus(), 0);
  };

  const hasComposeContent = () => {
    const signatureStripped = composeBody.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').trim();
    return composeTo.trim() || composeSubject.trim() || signatureStripped;
  };

  const handleClose = () => {
    if (hasComposeContent()) {
      onClose({ to: composeTo, cc: composeCc, bcc: composeBcc, subject: composeSubject, body: composeBody });
    } else {
      onDiscard();
    }
  };

  const execFormat = (cmd: string, value?: string) => {
    bodyRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const handleSend = async () => {
    if (!composeTo || !composeSubject) {
      showToast({ type: 'error', title: 'Thiếu thông tin', message: 'Vui lòng nhập người nhận và tiêu đề.' });
      return;
    }

    const formData = new FormData();
    formData.append('to', composeTo);
    if (composeCc) formData.append('cc', composeCc);
    if (composeBcc) formData.append('bcc', composeBcc);
    formData.append('subject', composeSubject);
    formData.append('body', composeBody);
    formData.append('track', trackOpens.toString());

    composeAttachments.forEach(file => {
      formData.append('attachments', file);
    });

    if (scheduleAt) {
      formData.append('scheduledAt', new Date(scheduleAt).toISOString());
      setIsSending(true);
      try {
        const res = await apiFetch('/api/mail/schedule', { method: 'POST', body: formData });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed');
        }
        showToast({ type: 'success', title: 'Thành công', message: 'Đã lên lịch gửi email.' });
        onDiscard(); // Clear draft and close
      } catch (err: any) {
        showToast({ type: 'error', title: 'Lỗi', message: err.message });
      } finally { setIsSending(false); }
      return;
    }

    setIsSending(true);
    try {
      const res = await apiFetch('/api/mail/send', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }
      const resData = await res.json();
      onSendSuccess(resData.message || `Email đến "${composeTo}" đã được gửi.`, composeSubject, composeTo);
      onDiscard(); // Clear draft and close modal on success
    } catch (err: any) {
      showToast({ type: 'error', title: 'Gửi thất bại', message: err.message || 'Lỗi không xác định.' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="absolute bottom-0 right-6 w-[620px] max-h-[70vh] bg-white rounded-t-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden"
      style={{ animation: 'slideUpCompose 0.25s ease-out' }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
      onDrop={e => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const newFiles = Array.from(e.dataTransfer.files);
          setComposeAttachments(prev => {
            const allFiles = [...prev, ...newFiles];
            const totalSize = allFiles.reduce((acc, file) => acc + file.size, 0);
            if (totalSize > 25 * 1024 * 1024) {
              showToast({ type: 'error', title: 'Quá dung lượng', message: 'Tổng dung lượng đính kèm không được vượt quá 25MB.' });
              return prev;
            }
            return allFiles;
          });
        }
      }}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center border-4 border-dashed border-blue-400 m-2 rounded-xl">
          <Paperclip size={48} className="text-blue-500 mb-4 animate-bounce" />
          <p className="text-xl font-bold text-blue-600">Thả file vào đây</p>
          <p className="text-sm text-blue-400 mt-2">Đính kèm tối đa 25MB</p>
        </div>
      )}

      {/* Header */}
      <div className="h-13 px-5 py-3.5 bg-gradient-to-r from-gray-900 to-gray-800 rounded-t-2xl flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Edit3 size={15} className="text-blue-400" />
          <span className="font-semibold text-white text-sm">Thư mới</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleClose} title="Thu nhỏ/Lưu nháp" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <ChevronDown size={16} />
          </button>
          <button onClick={handleClose} title="Đóng" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Fields */}
      <div className="flex flex-col border-b border-gray-100">
        <div className="relative flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-400 w-14 flex-shrink-0">Đến</span>
          <input
            ref={toInputRef}
            type="text" placeholder="email1@..., email2@..."
            title="Nhập các email cách nhau bởi dấu phẩy"
            value={composeTo}
            onChange={e => setComposeTo(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={e => {
              if (!showSuggestions) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestionIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' || e.key === 'Tab') { if (suggestionIdx >= 0) { e.preventDefault(); pickSuggestion(suggestions[suggestionIdx].email); } }
              else if (e.key === 'Escape') { setShowSuggestions(false); }
            }}
            className="flex-1 text-sm focus:outline-none text-gray-800 placeholder-gray-300"
          />
          <div className="flex gap-2">
            {!showCc && <button onClick={() => setShowCc(true)} className="text-xs text-gray-400 hover:text-blue-600 font-semibold">Cc</button>}
            {!showBcc && <button onClick={() => setShowBcc(true)} className="text-xs text-gray-400 hover:text-blue-600 font-semibold">Bcc</button>}
          </div>
          {/* Autocomplete Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden mt-1" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.13)' }}>
              {suggestions.map((s, i) => (
                <div
                  key={s.email}
                  onMouseDown={() => pickSuggestion(s.email)}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${i === suggestionIdx ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarColor(s.name || s.email)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                    {(s.name || s.email)[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    {s.name && <p className="text-xs font-semibold text-gray-800 truncate">{s.name}</p>}
                    <p className="text-xs text-gray-400 truncate">{s.email}</p>
                  </div>
                  {s.name && <span className="ml-auto text-[10px] text-gray-300">↵</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {showCc && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 bg-gray-50/30">
            <span className="text-xs font-semibold text-gray-400 w-14 flex-shrink-0">Cc</span>
            <input
              type="text" placeholder="Người nhận bản sao..."
              value={composeCc} onChange={e => setComposeCc(e.target.value)}
              className="flex-1 text-sm focus:outline-none text-gray-800 bg-transparent placeholder-gray-300"
            />
            <button onClick={() => { setShowCc(false); setComposeCc(''); }} className="text-gray-400 hover:text-red-500"><X size={12} /></button>
          </div>
        )}

        {showBcc && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 bg-gray-50/30">
            <span className="text-xs font-semibold text-gray-400 w-14 flex-shrink-0">Bcc</span>
            <input
              type="text" placeholder="Người nhận bản sao ẩn..."
              value={composeBcc} onChange={e => setComposeBcc(e.target.value)}
              className="flex-1 text-sm focus:outline-none text-gray-800 bg-transparent placeholder-gray-300"
            />
            <button onClick={() => { setShowBcc(false); setComposeBcc(''); }} className="text-gray-400 hover:text-red-500"><X size={12} /></button>
          </div>
        )}

        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-400 w-14 flex-shrink-0">Tiêu đề</span>
          <input
            type="text" placeholder="Nhập tiêu đề..."
            value={composeSubject} onChange={e => setComposeSubject(e.target.value)}
            className="flex-1 text-sm font-medium focus:outline-none text-gray-800 placeholder-gray-300"
          />
        </div>

        {/* Attachments List */}
        {composeAttachments.length > 0 && (
          <div className="px-5 py-2 bg-gray-50 max-h-20 overflow-y-auto flex flex-wrap gap-2">
            {composeAttachments.map((f, idx) => (
              <div key={idx} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded text-xs px-2 py-1 shadow-sm">
                <span className="text-gray-600 max-w-[120px] truncate" title={f.name}>{f.name}</span>
                <button onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Body - Rich Text */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Rich Text Toolbar */}
        <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-gray-100 bg-gray-50/50">
          {[
            { cmd: 'bold', icon: Bold, title: 'Bật đậm (Ctrl+B)' },
            { cmd: 'italic', icon: Italic, title: 'Nghiêng (Ctrl+I)' },
            { cmd: 'underline', icon: Underline, title: 'Gạch chân (Ctrl+U)' },
          ].map(({ cmd, icon: Icon, title }) => (
            <button
              key={cmd}
              onMouseDown={e => { e.preventDefault(); execFormat(cmd); }}
              title={title}
              className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
            >
              <Icon size={13} />
            </button>
          ))}
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button
            onMouseDown={e => {
              e.preventDefault();
              const url = prompt('Nhập URL liên kết:');
              if (url) execFormat('createLink', url);
            }}
            title="Chèn liên kết"
            className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
          >
            <Link size={13} />
          </button>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'].map(color => (
            <button
              key={color}
              onMouseDown={e => { e.preventDefault(); execFormat('foreColor', color); }}
              style={{ background: color }}
              className="w-4 h-4 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
              title={`Màu ${color}`}
            />
          ))}
        </div>
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          onInput={e => setComposeBody(DOMPurify.sanitize((e.target as HTMLDivElement).innerHTML))}
          data-placeholder="Viết nội dung email..."
          className="flex-1 overflow-y-auto px-5 py-4 text-sm text-gray-700 leading-relaxed focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-300"
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSend}
            disabled={isSending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-md shadow-blue-200 disabled:opacity-60"
          >
            {isSending ? <RefreshCw className="animate-spin" size={15} /> : <Send size={15} />}
            {isSending ? 'Đang xử lý...' : (scheduleAt ? 'Lên lịch' : 'Gửi')}
          </button>

          <div className="flex items-center">
            <input
              id="mail-attachment-input"
              type="file" multiple className="hidden"
              onChange={e => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  const newFiles = Array.from(files);
                  setComposeAttachments(prev => {
                    const allFiles = [...prev, ...newFiles];
                    const totalSize = allFiles.reduce((acc, file) => acc + file.size, 0);
                    if (totalSize > 25 * 1024 * 1024) {
                      showToast({ type: 'error', title: 'Quá dung lượng', message: 'Tổng dung lượng đính kèm không được vượt quá 25MB.' });
                      return prev;
                    }
                    return allFiles;
                  });
                }
                e.target.value = '';
              }}
            />
            <label
              htmlFor="mail-attachment-input"
              className="p-2.5 flex text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
              title="Đính kèm tệp (Tối đa 25MB)"
            >
              <Paperclip size={18} />
            </label>
          </div>

          <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
            <label className="flex items-center gap-1.5 cursor-pointer" title="Theo dõi lượt đọc email">
              <input type="checkbox" checked={trackOpens} onChange={e => setTrackOpens(e.target.checked)} className="rounded text-blue-500 w-3.5 h-3.5 border-gray-300 focus:ring-blue-500" />
              <span className="text-xs text-gray-500">Tracking</span>
            </label>
            <div className="relative flex items-center">
              <Flatpickr
                value={scheduleAt ? new Date(scheduleAt) : ''}
                onChange={([date]) => setScheduleAt(date ? toLocalDatetimeString(date) : '')}
                options={{ enableTime: true, time_24hr: true, dateFormat: 'd/m/Y H:i', minDate: 'today' }}
                placeholder="Gửi theo lịch"
                className="text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-600 focus:outline-none focus:border-blue-500 pr-6 min-w-[140px]"
              />
              {scheduleAt && (
                <button onClick={() => setScheduleAt('')} className="absolute right-1 text-gray-400 hover:text-red-500" title="Xóa lịch gửi">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        <button onClick={onDiscard} title="Xóa bản nháp" className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
          <Trash2 size={17} />
        </button>
      </div>
    </div>
  );
}
