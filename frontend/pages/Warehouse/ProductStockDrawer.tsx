import { X } from 'lucide-react';
import type { ProductStockDetail } from '../../services/stockMasterService';

interface Props {
  detail: ProductStockDetail | null;
  loading: boolean;
  isManager: boolean;
  onClose: () => void;
  onTransfer: (productId: string) => void;
}

export function ProductStockDrawer({ detail, loading, isManager, onClose, onTransfer }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white dark:bg-slate-800 h-full overflow-y-auto shadow-2xl p-5 space-y-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100">
              {detail ? String(detail.product.code) : 'Chi tiết hàng hóa'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {detail ? String(detail.product.name) : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100" title="Đóng">
            <X size={18} />
          </button>
        </div>

        {loading || !detail ? (
          <p className="text-sm text-gray-400 text-center py-8">Đang tải...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Khả dụng', value: detail.totals.available, highlight: true },
                { label: 'Đã giữ', value: detail.totals.reserved },
                { label: 'Thực tồn', value: detail.totals.onHand },
                { label: 'Model / Brand', value: `${String(detail.product.model || '-')} / ${String(detail.product.brand || '-')}`, text: true },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl border p-3 ${s.highlight ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'}`}>
                  <p className="text-[11px] font-bold text-gray-500 uppercase">{s.label}</p>
                  <p className={`text-lg font-black ${s.highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-800 dark:text-slate-100'}`}>
                    {s.text ? s.value : Number(s.value).toLocaleString('vi-VN')}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Tồn theo kho / vị trí</h3>
              {detail.breakdown.length === 0 ? (
                <p className="text-sm text-gray-400">Chưa có tồn kho.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-slate-700 border border-gray-100 dark:border-slate-700 rounded-xl overflow-hidden">
                  {detail.breakdown.map((b, idx) => (
                    <li key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="font-semibold">
                        {b.warehouseCode}{b.locationCode ? ` / ${b.locationCode}` : ''}
                      </span>
                      <span>
                        <span className="font-black text-emerald-700 dark:text-emerald-300">{b.available.toLocaleString('vi-VN')}</span>
                        <span className="text-gray-400 text-xs"> / giữ {b.reserved.toLocaleString('vi-VN')} / tồn {b.onHand.toLocaleString('vi-VN')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isManager && detail.reservations && detail.reservations.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Đang giữ hàng</h3>
                <ul className="space-y-1">
                  {detail.reservations.map((r) => (
                    <li key={r.id} className="text-sm px-3 py-2 bg-blue-50/60 dark:bg-slate-700/40 rounded-xl">
                      <span className="font-bold">{Number(r.qty - r.qtyConsumed).toLocaleString('vi-VN')}</span>
                      <span className="text-gray-500"> cho {r.sourceType}{r.sourceId ? ` ${r.sourceId}` : ''} ({r.warehouseCode})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Lịch sử biến động</h3>
              {detail.moves.length === 0 ? (
                <p className="text-sm text-gray-400">Chưa có biến động nào.</p>
              ) : (
                <ol className="relative border-l-2 border-gray-100 dark:border-slate-700 ml-2 space-y-3">
                  {detail.moves.map((m) => (
                    <li key={m.id} className="ml-4">
                      <span className={`absolute -left-[25px] mt-1 w-3 h-3 rounded-full border-2 border-white ${m.qty >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      <p className="text-sm font-bold text-gray-800 dark:text-slate-100">
                        {m.qty >= 0 ? '+' : ''}{Number(m.qty).toLocaleString('vi-VN')}
                        <span className="ml-1 font-semibold text-gray-500">• {m.moveType}</span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {m.docCode || ''} • {m.warehouseCode || ''} • {new Date(m.createdAt).toLocaleString('vi-VN')}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {isManager && detail.product.id && (
              <button
                onClick={() => onTransfer(detail.product.id)}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors"
              >
                Tạo điều chuyển
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
