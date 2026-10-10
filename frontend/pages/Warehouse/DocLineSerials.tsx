import { useCallback, useEffect, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { registerDocSerials, searchSerials, type SerialItem } from '../../services/stockMasterService';

interface Props {
  docType: 'RECEIPT' | 'ISSUE';
  docId: string;
  lineId: string;
  productTracking?: string;
  editable: boolean;
}

// Serial chips + add box for SERIAL-tracked lines inside receipt/issue details.
export function DocLineSerials({ docType, docId, lineId, productTracking, editable }: Props) {
  const [serials, setSerials] = useState<SerialItem[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSerials(await searchSerials({ lineId }));
    } catch {
      setSerials([]);
    }
  }, [lineId]);

  useEffect(() => { load(); }, [load]);

  if (productTracking !== 'SERIAL') return null;

  const handleAdd = async () => {
    const list = input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    try {
      setSaving(true);
      setError(null);
      await registerDocSerials(docId, lineId, { serials: list });
      setInput('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu serial thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1.5 rounded-lg bg-gray-50 dark:bg-slate-700/40 px-2.5 py-2">
      <p className="text-[11px] font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
        <ScanLine size={12} /> Serial ({serials.length})
      </p>
      {serials.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {serials.map((s) => (
            <span key={s.id} title={`${s.status}${s.lotCode ? ` • Lô ${s.lotCode}` : ''}`}
              className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 font-mono text-[11px] font-bold">
              {s.serialNo}
            </span>
          ))}
        </div>
      )}
      {editable ? (
        <>
          <div className="flex gap-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder={docType === 'RECEIPT' ? 'Quét/nhập serial, cách nhau bởi dấu phẩy...' : 'Gán serial đã nhập kho...'}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
            />
            <button
              onClick={handleAdd} disabled={saving}
              className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
            >
              {docType === 'RECEIPT' ? 'Đăng ký' : 'Gán'}
            </button>
          </div>
          {error && <p className="text-[11px] font-bold text-rose-600 mt-1">{error}</p>}
        </>
      ) : (
        serials.length === 0 && <p className="text-[11px] text-gray-400">Chưa có serial nào.</p>
      )}
    </div>
  );
}
