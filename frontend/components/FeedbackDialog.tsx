import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, X, XCircle } from 'lucide-react';

export function FeedbackDialog({
  title,
  message,
  tone = 'warning',
  actionLabel,
  onAction,
  onClose,
  secondaryLabel = 'Đóng',
}: {
  title: string;
  message: string;
  tone?: 'warning' | 'error' | 'success';
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  secondaryLabel?: string;
}) {
  const Icon = tone === 'error' ? XCircle : tone === 'success' ? CheckCircle2 : AlertTriangle;
  const iconClass = tone === 'error' ? 'bg-red-100 text-red-600' : tone === 'success' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600';
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/35 backdrop-blur-[2px] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-start gap-3 p-5">
          <div className={`mt-0.5 rounded-full p-2 ${iconClass}`}><Icon size={20} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-gray-900">{title}</h3>
              <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg" aria-label="Đóng"><X size={17} /></button>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-200">{secondaryLabel}</button>
          {actionLabel && onAction && (
            <button type="button" onClick={onAction} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm">
              {actionLabel}<ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
