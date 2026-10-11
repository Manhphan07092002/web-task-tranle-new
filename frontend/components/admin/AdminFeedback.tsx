import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X, Trash2, RefreshCw } from 'lucide-react';

export interface AdminToastData {
  title: string;
  msg?: string;
  type: 'success' | 'error' | 'info';
}

// Thông báo thêm/sửa/xóa dùng chung cho các trang quản trị:
// thẻ trắng, icon gradient, thanh tiến trình tự đóng, nút tắt.
export const AdminToastBar: React.FC<{ toast: AdminToastData | null; onClose: () => void }> = ({ toast, onClose }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) { setVisible(false); return; }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [toast]);
  if (!toast) return null;

  const conf = {
    success: { ring: 'border-emerald-100', iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500', bar: 'bg-emerald-500', Icon: CheckCircle2 },
    error: { ring: 'border-red-100', iconBg: 'bg-gradient-to-br from-red-500 to-rose-500', bar: 'bg-red-500', Icon: AlertCircle },
    info: { ring: 'border-blue-100', iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-500', bar: 'bg-blue-500', Icon: Info },
  }[toast.type];
  const { Icon } = conf;

  return (
    <div className={`fixed top-5 right-5 z-[100] w-[calc(100vw-2.5rem)] max-w-sm transition-all duration-300 ${visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}`}>
      <style>{`@keyframes adminToastBar{from{width:100%}to{width:0%}}`}</style>
      <div className={`bg-white rounded-2xl shadow-2xl border ${conf.ring} overflow-hidden`}>
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span className={`w-9 h-9 rounded-xl ${conf.iconBg} flex items-center justify-center flex-shrink-0 shadow-md`}>
            <Icon size={18} className="text-white" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-bold text-gray-900 leading-snug">{toast.title}</span>
            {toast.msg && <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">{toast.msg}</span>}
          </span>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0" title="Đóng">
            <X size={15} />
          </button>
        </div>
        <div className="h-1 bg-gray-100">
          <div className={`h-full ${conf.bar} rounded-r-full`} style={{ animation: 'adminToastBar 3.5s linear forwards' }} />
        </div>
      </div>
    </div>
  );
};

// Modal xác nhận xóa dùng chung: icon cảnh báo, tên item, hậu quả, nút rõ ràng.
export const AdminDeleteModal: React.FC<{
  title: string;
  itemName: string;
  itemSub?: string;
  warning?: string;
  confirmText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, itemName, itemSub, warning, confirmText = 'Xóa ngay', busy, onCancel, onConfirm }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
      <div className="p-6 pb-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-red-200">
          <Trash2 size={24} className="text-white" />
        </div>
        <h3 className="text-lg font-black text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 mt-1">Bạn sắp xóa:</p>
        <p className="font-bold text-gray-900 mt-0.5 break-words">“{itemName}”</p>
        {itemSub && <p className="text-xs text-gray-400 mt-1">{itemSub}</p>}
        {warning && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs font-medium text-left">
            <AlertCircle size={14} className="flex-shrink-0" />{warning}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">Hành động này không thể hoàn tác.</p>
      </div>
      <div className="flex gap-3 px-6 pb-6">
        <button onClick={onCancel} disabled={busy}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60">
          Hủy bỏ
        </button>
        <button onClick={onConfirm} disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-white text-sm font-bold shadow-md shadow-red-200 hover:shadow-red-300 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
          {busy ? <><RefreshCw size={15} className="animate-spin" />Đang xóa...</> : <><Trash2 size={15} />{confirmText}</>}
        </button>
      </div>
    </div>
  </div>
);
