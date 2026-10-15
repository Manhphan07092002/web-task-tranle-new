import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ScanLine, RefreshCw, AlertCircle, CheckCircle2, ArrowLeft, PackageCheck, Boxes, Hash, Camera } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockDocument, getDocumentProgress, scanSerial, scanOutSerial, registerLot, confirmLineQty,
  type DocProgress, type DocLineProgress,
} from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { ScannerModal } from './StockDocs/ScannerModal';

const TRACK_LABEL: Record<string, string> = { SERIAL: 'Serial', LOT: 'Lô/Cuộn', QUANTITY: 'Số lượng' };

// Chế độ xử lý Serial/Lô theo phiếu (?documentId=): tiến độ từng dòng,
// quét serial, đăng ký lô, xác nhận số lượng. Không động vào danh sách chung.
export default function SerialDocMode({ deptKey }: { deptKey: DeptKey }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const documentId = params.get('documentId') || '';
  const [doc, setDoc] = useState<{ code?: string | null; docType: string; status: string; warehouseName?: string | null } | null>(null);
  const [progress, setProgress] = useState<DocProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!documentId) return;
    setLoading(true); setError(null);
    try {
      const [d, p] = await Promise.all([getStockDocument(documentId), getDocumentProgress(documentId)]);
      setDoc(d);
      setProgress(p);
    } catch (e: any) {
      setError(e.message || 'Không tải được phiếu');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const backPath = `${getDeptHomePath(deptKey) || '/'}?m=${doc?.docType === 'ISSUE' ? 'wh_issue' : 'wh_receipt'}`;

  if (!documentId) {
    return (
      <div className="w-full max-w-[1400px] mx-auto space-y-4">
        <Card className="py-16 text-center text-gray-400">
          <p className="font-medium">Thiếu mã phiếu — mở từ nút “Xử lý Serial/Lô” trên phiếu.</p>
          <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block mt-3 text-sm text-emerald-600 hover:underline font-medium">← Về tổng quan kho vận</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Xử lý hàng hóa</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">
            Đang xử lý phiếu {doc?.code || '…'}
          </h1>
          {progress && (
            <p className="text-gray-500 text-sm mt-1">
              {progress.lines.filter((l) => l.status === 'COMPLETED').length}/{progress.lines.length} dòng đã đủ
              {progress.allCompleted ? ' — ✓ đủ điều kiện hoàn tất, quay lại phiếu để bấm Hoàn tất.' : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate(backPath)}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl font-bold text-sm shadow-sm">
            <ArrowLeft size={16} /> Quay lại phiếu
          </button>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải tiến độ...</p>
        </div>
      ) : progress && (
        <div className="space-y-3">
          {progress.allCompleted && (
            <div className="flex items-center gap-2 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 font-bold text-sm">
              <CheckCircle2 size={18} /> Serial/Lô đã hoàn tất — quay lại phiếu để bấm Hoàn tất nhận/giao hàng.
            </div>
          )}
          {progress.lines.map((line) => (
            <LineCard key={line.lineId} line={line} docType={doc?.docType || ''} documentId={progress.documentId} onDone={fetchAll} />
          ))}
        </div>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function statusBadge(status: string) {
  if (status === 'COMPLETED') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">Đủ</span>;
  if (status === 'PARTIAL') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-amber-50 text-amber-700 border-amber-200">Chưa đủ</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-gray-100 text-gray-500 border-gray-200">Chưa xử lý</span>;
}

function LineCard({ line, docType, documentId, onDone }: { line: DocLineProgress; docType: string; documentId: string; onDone: () => Promise<void> }) {
  const isIssue = docType === 'ISSUE';
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-bold text-gray-900">{line.productName}</p>
          <p className="text-xs text-gray-400 font-mono">{line.productId}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">{TRACK_LABEL[line.tracking] || line.tracking}</span>
          {statusBadge(line.status)}
        </div>
      </div>
      <p className="text-sm text-gray-600 mt-2">
        Yêu cầu: <b className="font-mono">{line.required.toLocaleString('vi-VN')}</b>
        {' · '}Đã xử lý: <b className="font-mono">{line.processed.toLocaleString('vi-VN')}</b>
        {' · '}Còn thiếu: <b className="font-mono">{Math.max(0, line.required - line.processed).toLocaleString('vi-VN')}</b>
      </p>
      <div className="mt-3">
        {line.tracking === 'SERIAL' && (
          <SerialBox line={line} isIssue={isIssue} documentId={documentId} onDone={onDone} />
        )}
        {line.tracking === 'LOT' && !isIssue && (
          <LotBox line={line} documentId={documentId} onDone={onDone} />
        )}
        {line.tracking === 'LOT' && isIssue && (
          <div className="text-xs text-gray-500">
            {line.serials.length > 0 ? `Mã lô trên phiếu: ${line.serials.join(', ')}` : 'Chưa có mã lô — sửa phiếu để bổ sung.'}
          </div>
        )}
        {line.tracking === 'QUANTITY' && (
          <QuantityBox line={line} onDone={onDone} />
        )}
      </div>
    </Card>
  );
}

function SerialBox({ line, isIssue, documentId, onDone }: { line: DocLineProgress; isIssue: boolean; documentId: string; onDone: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  const submitOne = async (code: string): Promise<string | null> => {
    try {
      await (isIssue ? scanOutSerial : scanSerial)(documentId, line.lineId, code);
      return null;
    } catch (e: any) {
      return `${code}: ${e.message || 'thất bại'}`;
    }
  };

  const handleScannerDone = async (codes: string[]) => {
    setScanning(false);
    const fresh = codes.filter((c) => !line.serials.includes(c));
    if (fresh.length === 0) return;
    setBusy(true); setErr(''); setOkMsg('');
    const errs: string[] = [];
    let added = 0;
    for (const code of fresh) {
      const errMsg = await submitOne(code);
      if (errMsg) errs.push(errMsg);
      else added++;
    }
    if (added > 0) setOkMsg(`✓ Đã thêm ${added} serial`);
    if (errs.length > 0) setErr(errs.slice(0, 3).join(' | ') + (errs.length > 3 ? ` (+${errs.length - 3} lỗi khác)` : ''));
    setBusy(false);
    await onDone();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true); setErr(''); setOkMsg('');
    try {
      await (isIssue ? scanOutSerial : scanSerial)(documentId, line.lineId, code);
      setValue('');
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Thêm serial thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {line.serials.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {line.serials.map((s) => (
            <span key={s} className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 font-mono text-xs flex items-center gap-1">
              <CheckCircle2 size={12} className="text-emerald-500" />{s}
            </span>
          ))}
        </div>
      )}
      {line.status !== 'COMPLETED' && (
        <>
          <form onSubmit={submit} className="flex gap-2">
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Quét hoặc gõ serial rồi Enter..."
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500 font-mono" />
            <button type="button" onClick={() => { setErr(''); setOkMsg(''); setScanning(true); }}
              className="flex items-center gap-1.5 px-4 py-2 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-xl font-bold text-sm">
              <Camera size={15} /> Quét
            </button>
            <button type="submit" disabled={busy || !value.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              <ScanLine size={15} /> {busy ? '...' : 'Thêm'}
            </button>
          </form>
          {scanning && (
            <ScannerModal initial={line.serials} onClose={() => setScanning(false)} onDone={handleScannerDone} />
          )}
        </>
      )}
      {okMsg && <p className="text-xs text-emerald-600 font-bold mt-1.5">{okMsg}</p>}
      {err && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </div>
  );
}

function LotBox({ line, documentId, onDone }: { line: DocLineProgress; documentId: string; onDone: () => Promise<void> }) {
  const [lotCode, setLotCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !lotCode.trim() || !(Number(quantity) > 0)) return;
    setBusy(true); setErr('');
    try {
      await registerLot({
        documentId,
        documentLineId: line.lineId,
        lotCode: lotCode.trim(),
        quantity: Number(quantity),
        unit: unit.trim() || undefined,
      });
      setLotCode(''); setQuantity(''); setUnit('');
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Đăng ký lô thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {line.lots.length > 0 && (
        <div className="mb-2 border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-1.5 px-3 font-bold text-gray-500 uppercase">Mã lô/cuộn</th>
                <th className="text-right py-1.5 px-3 font-bold text-gray-500 uppercase">Số lượng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {line.lots.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 px-3 font-mono font-bold text-gray-800">{l.lotCode}{l.coilCode ? ` · ${l.coilCode}` : ''}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{Number(l.initialQty).toLocaleString('vi-VN')}{l.unit ? ` ${l.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {line.status !== 'COMPLETED' && (
        <form onSubmit={submit} className="flex gap-2 flex-wrap">
          <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Mã lô/cuộn *"
            className="flex-1 min-w-[140px] px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500 font-mono" />
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Số lượng *" inputMode="decimal"
            className="w-28 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none text-right tabular-nums focus:border-emerald-500" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ĐVT"
            className="w-20 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500" />
          <button type="submit" disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
            <Boxes size={15} /> {busy ? '...' : 'Thêm lô'}
          </button>
        </form>
      )}
      {err && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </div>
  );
}

function QuantityBox({ line, onDone }: { line: DocLineProgress; onDone: () => Promise<void> }) {
  const [actual, setActual] = useState(line.actualQty !== null && line.actualQty !== undefined ? String(line.actualQty) : String(line.required));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const needReason = Number(actual) !== line.required;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !(Number(actual) >= 0)) return;
    setBusy(true); setErr('');
    try {
      await confirmLineQty(line.lineId, { actualQty: Number(actual), varianceReason: needReason ? reason.trim() : undefined });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Xác nhận thất bại');
    } finally {
      setBusy(false);
    }
  };

  if (line.status === 'COMPLETED') {
    return (
      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <PackageCheck size={14} className="text-emerald-500" />
        Đã xác nhận: <b className="font-mono">{Number(line.actualQty).toLocaleString('vi-VN')}</b>
        {Number(line.varianceQty) !== 0 ? <span className="text-amber-600">(chênh {Number(line.varianceQty) > 0 ? '+' : ''}{Number(line.varianceQty).toLocaleString('vi-VN')})</span> : null}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2 flex-wrap items-center">
        <label className="text-xs text-gray-500 flex items-center gap-1"><Hash size={13} /> Số thực nhận:</label>
        <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal"
          className="w-32 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none text-right tabular-nums focus:border-emerald-500" />
        <button type="submit" disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
          <PackageCheck size={15} /> {busy ? '...' : 'Xác nhận số lượng'}
        </button>
      </div>
      {needReason && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do chênh lệch so với chứng từ *"
          className="w-full px-3 py-2 border border-amber-300 bg-amber-50/50 rounded-xl text-sm outline-none focus:border-amber-500" />
      )}
      {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </form>
  );
}
