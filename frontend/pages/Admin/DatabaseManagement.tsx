import { apiFetch } from '../../services/api';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Database, Download, FileUp, RefreshCw, Search, Trash2, CheckCircle2, History, Upload, ArrowDownToLine } from 'lucide-react';

type DbTable = { name: string; count?: number | null };

export default function AdminDatabaseManagement() {
  const [tables, setTables] = useState<DbTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [rowLoading, setRowLoading] = useState(false);
  const [rowError, setRowError] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importConfirmText, setImportConfirmText] = useState('');
  const [importSuccessMsg, setImportSuccessMsg] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchTables = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/admin/database/tables');
      const data = await res.json().catch(() => ([]));
      if (!res.ok) throw new Error(data.error || 'Không thể tải danh sách bảng');
      setTables(data);
      if (!selectedTable && data[0]?.name) setSelectedTable(data[0].name);
    } catch (e: any) {
      setError(e.message || 'Không thể tải database');
    } finally {
      setLoading(false);
    }
  };

  const fetchRows = async (table: string) => {
    if (!table) return;
    setRowLoading(true);
    setRowError('');
    try {
      const res = await apiFetch(`/api/admin/database/table/${table}?limit=50&offset=0`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể tải dữ liệu bảng');
      setRows(data.rows || []);
    } catch (e: any) {
      setRowError(e.message || 'Không thể tải dữ liệu bảng');
    } finally {
      setRowLoading(false);
    }
  };

  useEffect(() => { fetchTables(); fetchHistory(); }, []);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch('/api/admin/database/history');
      if (res.ok) setHistory(await res.json());
    } catch {}
    setHistoryLoading(false);
  };

  useEffect(() => { if (selectedTable) fetchRows(selectedTable); }, [selectedTable]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tables;
    const q = search.toLowerCase();
    return tables.filter(t => t.name.toLowerCase().includes(q));
  }, [tables, search]);

  const deleteRow = async (table: string, id: string) => {
    if (!confirm(`Xóa record ${id} khỏi bảng ${table}?`)) return;
    try {
      const confirmation = await apiFetch('/api/admin/database/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-row', table, id }),
      });
      const confirmationData = await confirmation.json().catch(() => ({}));
      if (!confirmation.ok || !confirmationData.token) throw new Error(confirmationData.error || 'Không thể xác nhận thao tác xóa');
      const result = await apiFetch(`/api/admin/database/table/${table}/row/${id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmToken: confirmationData.token }),
      });
      if (!result.ok) throw new Error('Không thể xóa record');
      await fetchRows(table);
      await fetchTables();
    } catch (e: any) {
      setRowError(e?.message || 'Không thể xóa record');
    }
  };

  const exportDb = async () => {
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `tranle-database-${new Date().toISOString().split('T')[0]}.json`,
          types: [{
            description: 'JSON Database Backup',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const res = await apiFetch('/api/admin/database/export');
        if (!res.ok) throw new Error('Không thể tải file database');
        const blob = await res.blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const res = await apiFetch('/api/admin/database/export');
        if (!res.ok) throw new Error('Không thể tải file database');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tranle-database-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        alert('Có lỗi khi xuất dữ liệu: ' + e.message);
      }
    }
  };

  const handleImportSelect = (file?: File | null) => {
    setImportError('');
    setImportStep(1);
    setImportConfirmText('');
    setImportFile(file || null);
  };

  const confirmImport = async () => {
    if (!importFile) return;
    setImportBusy(true);
    setImportError('');
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const confirmation = await apiFetch('/api/admin/database/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import' }),
      });
      const confirmationData = await confirmation.json().catch(() => ({}));
      if (!confirmation.ok || !confirmationData.token) throw new Error(confirmationData.error || 'Không thể xác nhận thao tác import');
      formData.append('confirmToken', confirmationData.token);
      const res = await apiFetch('/api/admin/database/import', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Import thất bại');
      setImportFile(null);
      setImportStep(1);
      setImportConfirmText('');
      setImportSuccessMsg('✅ Import thành công! Đang chờ server khởi động lại...');

      // Poll until backend is back up, then reload
      const waitForBackend = async () => {
        await new Promise(r => setTimeout(r, 3000)); // give backend time to exit
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const ping = await apiFetch('/api/admin/database/tables');
            if (ping.ok) {
              setImportSuccessMsg('✅ Server đã sẵn sàng! Đang tải lại trang...');
              await new Promise(r => setTimeout(r, 1500));
              window.location.reload();
              return;
            }
          } catch {}
        }
        window.location.reload(); // fallback
      };
      waitForBackend();
    } catch (e: any) {
      setImportError(e.message || 'Import thất bại');
      setImportBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {importSuccessMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm mx-4 text-center border border-green-100 transform transition-all animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-5 shadow-inner">
              <CheckCircle2 size={32} strokeWidth={2.5} />
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">Thành công!</h3>
            <p className="text-gray-500 text-sm leading-relaxed mb-6">{importSuccessMsg}</p>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full animate-[progress_10s_ease-in-out_forwards]" />
            </div>
            <style>{'\n@keyframes progress { from { width: 0%; } to { width: 100%; } }\n'}</style>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-slate-800 to-slate-600 rounded-2xl shadow-lg shadow-slate-200">
            <Database size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Quản lý Database</h1>
            <p className="text-sm text-gray-400 mt-0.5">Xem bảng, xem record, xóa record, export/import</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportDb} className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 text-gray-600 transition-all shadow-sm text-sm inline-flex items-center gap-2">
            <Download size={16} /> Export DB
          </button>
          <label className="px-4 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 transition-all shadow-sm text-sm inline-flex items-center gap-2 cursor-pointer">
            <FileUp size={16} /> Chọn file
            <input type="file" accept=".json" className="hidden" onChange={e => handleImportSelect(e.target.files?.[0])} />
          </label>
          <button onClick={fetchTables} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 transition-all shadow-sm">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-3 text-gray-400" size={16} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Tìm bảng..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-200 outline-none text-sm shadow-sm"
        />
      </div>

      {importFile && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3 text-amber-800">
            <AlertCircle size={18} className="mt-0.5" />
            <div>
              <p className="font-semibold">Cảnh báo import</p>
              <p className="text-sm text-amber-700">File sẽ được import vào database hiện tại. Hãy chắc chắn đây là file đúng, vì có thể ghi đè dữ liệu nếu backend cho phép.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-amber-800 font-medium">{importFile.name}</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-white/70 text-amber-700 border border-amber-200">Bước {importStep}/2</span>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-amber-800">Gõ IMPORT để xác nhận</label>
            <input
              value={importConfirmText}
              onChange={e => setImportConfirmText(e.target.value)}
              placeholder="IMPORT"
              className="w-full px-4 py-2.5 rounded-xl border border-amber-200 bg-white text-sm outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>

          <div className="flex items-center gap-2">
            {importStep === 1 ? (
              <button 
                onClick={() => setImportStep(2)} 
                disabled={importConfirmText !== 'IMPORT'}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tiếp tục
              </button>
            ) : (
              <button
                onClick={confirmImport}
                disabled={importBusy || importConfirmText !== 'IMPORT'}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {importBusy ? 'Đang import...' : 'Xác nhận import'}
              </button>
            )}
            <button onClick={() => handleImportSelect(null)} className="px-4 py-2 rounded-xl bg-white border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-50">Hủy</button>
          </div>

          {importError && <p className="text-sm text-red-600">{importError}</p>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 gap-3 text-gray-400">
          <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
          Đang tải database...
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-24 gap-3 text-red-500">
          <AlertCircle size={40} strokeWidth={1.5} />
          <p className="font-semibold">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden xl:col-span-1">
            <div className="px-5 py-4 border-b border-gray-100 text-sm text-gray-500 flex items-center justify-between">
              <span>{filtered.length} bảng</span>
              <span className="text-xs text-gray-400">Chọn bảng để xem</span>
            </div>
            <div className="divide-y divide-gray-100 max-h-[70vh] overflow-auto">
              {filtered.map(table => (
                <button
                  key={table.name}
                  onClick={() => setSelectedTable(table.name)}
                  className={`w-full px-5 py-4 flex items-center justify-between text-left transition-colors ${selectedTable === table.name ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                >
                  <div>
                    <p className="font-semibold text-gray-800">{table.name}</p>
                    <p className="text-xs text-gray-400">Bảng dữ liệu</p>
                  </div>
                  <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">{table.count ?? '—'} rows</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden xl:col-span-2">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-800">{selectedTable || 'Chưa chọn bảng'}</p>
                <p className="text-xs text-gray-400">{rowLoading ? 'Đang tải...' : `${rows.length} records`}</p>
              </div>
            </div>
            {rowError ? (
              <div className="p-6 text-red-500 flex items-center gap-2"><AlertCircle size={18} />{rowError}</div>
            ) : rowLoading ? (
              <div className="p-6 text-gray-400">Đang tải dữ liệu bảng...</div>
            ) : (
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                    <tr>
                      {rows[0] ? Object.keys(rows[0]).map(key => <th key={key} className="text-left px-4 py-3 font-semibold text-gray-600">{key}</th>) : <th className="text-left px-4 py-3 font-semibold text-gray-600">No data</th>}
                      {rows[0] && <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                        {Object.values(row).map((value, i) => <td key={i} className="px-4 py-3 text-gray-700 max-w-[240px] break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</td>)}
                        <td className="px-4 py-3">
                          {row.id ? (
                            <button onClick={() => deleteRow(selectedTable, String(row.id))} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-medium">
                              <Trash2 size={14} /> Xóa
                            </button>
                          ) : <span className="text-xs text-gray-400">-</span>}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td className="px-4 py-8 text-gray-400" colSpan={2}>Không có dữ liệu.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DB History */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History size={18} className="text-indigo-500" />
            <h2 className="font-bold text-gray-800">Lịch sử cập nhật Database</h2>
          </div>
          <button onClick={fetchHistory} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 transition-all" title="Làm mới">
            <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {historyLoading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Đang tải lịch sử...</div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <History size={32} className="mx-auto mb-2 opacity-30" />
            <p>Chưa có lịch sử cập nhật.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {history.map((item, idx) => (
              <div key={item.id || idx} className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className={`mt-1 w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  item.action === 'import'
                    ? 'bg-blue-50 text-blue-500'
                    : 'bg-emerald-50 text-emerald-500'
                }`}>
                  {item.action === 'import'
                    ? <Upload size={16} />
                    : <ArrowDownToLine size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      item.action === 'import'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {item.action === 'import' ? '⬆ IMPORT' : '⬇ EXPORT'}
                    </span>
                    <span className="text-sm font-medium text-gray-700 truncate">{item.filename}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{item.note}</p>
                </div>
                <div className="text-xs text-gray-400 flex-shrink-0 text-right">
                  {new Date(item.createdAt).toLocaleString('vi-VN')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
