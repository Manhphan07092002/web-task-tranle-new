import React, { useEffect, useState } from 'react';
import { getStockLocations, type StockLocation } from '../../services/locationService';
import { advanceTransfer } from '../../services/stockService';

export function ReceiveTransferButton({ id, warehouseId, onDone }: { id: string; warehouseId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(''); setLocationId('');
    getStockLocations(warehouseId).then(rows => { if (active) setLocations(rows.filter(row => row.isActive)); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, warehouseId]);
  const receive = async () => {
    setSaving(true); setError('');
    try { await advanceTransfer(id, 'receive', locationId); setOpen(false); await onDone(); }
    catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };
  return <>
    <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">Xác nhận nhận</button>
    {open && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 text-left" role="dialog" aria-modal="true" aria-label="Nhận điều chuyển">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="font-bold text-lg">Nhận hàng vào kho đích</h2>
        <label className="block">Vị trí nhận
          <select disabled={loading || saving} value={locationId} onChange={e => setLocationId(e.target.value)} className="block w-full border rounded-lg p-2 mt-2">
            <option value="">Chưa phân vị trí</option>
            {locations.map(location => <option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}
          </select>
        </label>
        {loading && <p>Đang tải vị trí...</p>}
        {error && <p role="alert" className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button disabled={saving} onClick={() => setOpen(false)}>Hủy</button>
          <button disabled={loading || saving} onClick={receive} className="bg-emerald-600 text-white px-4 py-2 rounded-lg disabled:opacity-50">{saving ? 'Đang nhận...' : 'Nhận toàn bộ phiếu'}</button>
        </div>
      </div>
    </div>}
  </>;
}
