import React, { useState, useEffect } from 'react';
import { 
  FileText, FileSpreadsheet, FileArchive, FileImage, FileCode, File, 
  Trash2, Download, Edit, Search, Filter, UploadCloud, Check, 
  Loader2, Info, ExternalLink, RefreshCw, FolderOpen, Database,
  ChevronRight, ChevronDown
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { Button, Card, Input, Modal, Avatar } from '../../components/UI';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { 
  getDocuments, createDocument, updateDocument, deleteDocument, uploadFiles, downloadDocumentFile, Document
} from '../../services/documentService';

export default function DocumentsPage() {
  const { user } = useAuth();
  const { users, contracts, projects, reports } = useData();

  // State quản lý danh sách tài liệu
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trạng thái cấu trúc thư mục
  const [viewMode, setViewMode] = useState<'list' | 'folder'>('list');
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleUserFolder = (uId: string) => {
    setExpandedUsers(prev => ({ ...prev, [uId]: !prev[uId] }));
  };

  const toggleCategoryFolder = (key: string) => {
    setExpandedCategories(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Bộ lọc
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [createdBy, setCreatedBy] = useState('all');
  const [linkedId, setLinkedId] = useState('all');

  // Quản lý upload
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [uploadCategory, setUploadCategory] = useState('others');
  const [uploadLinkedId, setUploadLinkedId] = useState('');
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  // Quản lý Sửa metadata
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLinkedId, setEditLinkedId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Quản lý Xóa tài liệu
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Quyền người dùng
  const perms = user?.permissions || [];
  const canViewAll = perms.includes('admin_panel') || perms.includes('view_all_reports') || perms.includes('view_all_tasks') || user?.role === 'Manager';

  // Tải danh sách tài liệu từ server
  const loadDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params: any = {};
      if (category !== 'all') params.category = category;
      if (createdBy !== 'all') params.createdBy = createdBy;
      if (linkedId !== 'all') params.linkedId = linkedId;
      if (search.trim()) params.search = search.trim();

      const data = await getDocuments(params);
      setDocuments(data);
    } catch (e: any) {
      setError(e.message || 'Không thể tải danh sách tài liệu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [category, createdBy, linkedId]);

  // Tìm kiếm với Debounce thủ công hoặc gọi khi nhấn Enter
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      loadDocuments();
    }
  };

  // Định dạng kích thước file
  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Chọn icon phù hợp theo mimeType
  const getFileIconInfo = (mimeType: string) => {
    const t = mimeType.toLowerCase();
    if (t.includes('pdf')) {
      return { Icon: FileText, color: 'text-rose-500 bg-rose-50 dark:bg-rose-950/20' };
    }
    if (t.includes('word') || t.includes('document') || t.includes('msword') || t.includes('docx')) {
      return { Icon: FileText, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/20' };
    }
    if (t.includes('excel') || t.includes('spreadsheet') || t.includes('sheet') || t.includes('xls') || t.includes('xlsx')) {
      return { Icon: FileSpreadsheet, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' };
    }
    if (t.includes('zip') || t.includes('rar') || t.includes('archive') || t.includes('tar') || t.includes('gzip')) {
      return { Icon: FileArchive, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20' };
    }
    if (t.includes('image') || t.includes('png') || t.includes('jpg') || t.includes('jpeg') || t.includes('gif')) {
      return { Icon: FileImage, color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/20' };
    }
    if (t.includes('javascript') || t.includes('typescript') || t.includes('json') || t.includes('html') || t.includes('css')) {
      return { Icon: FileCode, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/20' };
    }
    return { Icon: File, color: 'text-gray-500 bg-gray-50 dark:bg-gray-800' };
  };

  // Xử lý kéo thả upload file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setUploadQueue(prev => [...prev, ...filesArray]);
    }
  };

  const removeFileFromQueue = (index: number) => {
    setUploadQueue(prev => prev.filter((_, i) => i !== index));
  };

  // Thực hiện tải lên và lưu vào DB
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadQueue.length === 0) return;

    try {
      setUploading(true);
      setError(null);

      // 1. Tải các file lên ổ đĩa qua API Upload
      const uploadRes = await uploadFiles(
        uploadQueue,
        uploadCategory === 'others' || !uploadLinkedId ? undefined : uploadCategory as 'contracts' | 'projects' | 'reports',
        uploadLinkedId || undefined,
      );
      
      // 2. Lưu thông tin metadata của các file đã tải vào SQLite
      for (const f of uploadRes.files) {
        await createDocument({
          id: '',
          name: f.name,
          url: f.url,
          size: f.size,
          type: f.type,
          category: uploadCategory,
          linkedId: uploadLinkedId || undefined
        });
      }

      setUploadSuccessMsg(`Tải lên thành công ${uploadQueue.length} tài liệu!`);
      setUploadQueue([]);
      setUploadLinkedId('');
      loadDocuments();

      setTimeout(() => setUploadSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message || 'Lỗi khi tải tệp tin lên server');
    } finally {
      setUploading(false);
    }
  };

  // Xử lý sửa tài liệu
  const handleOpenEdit = (doc: Document) => {
    setEditingDoc(doc);
    setEditName(doc.name);
    setEditCategory(doc.category);
    setEditLinkedId(doc.linkedId || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDoc) return;

    try {
      setSavingEdit(true);
      await updateDocument(editingDoc.id, {
        name: editName,
        category: editCategory,
        linkedId: editLinkedId || undefined
      });
      setEditingDoc(null);
      loadDocuments();
    } catch (e: any) {
      setError(e.message || 'Lỗi khi cập nhật tài liệu');
    } finally {
      setSavingEdit(false);
    }
  };

  // Xử lý xóa tài liệu
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;

    try {
      await deleteDocument(deleteConfirmId);
      setDeleteConfirmId(null);
      loadDocuments();
    } catch (e: any) {
      setError(e.message || 'Lỗi khi xóa tài liệu');
    }
  };

  // Phân nhóm tài liệu cho Cấu trúc thư mục
  const groupedDocuments = React.useMemo(() => {
    const groups: {
      [userId: string]: {
        user: any;
        categories: { [cat: string]: Document[] };
        totalSize: number;
        totalCount: number;
      };
    } = {};

    documents.forEach(doc => {
      const uId = doc.createdBy || 'anonymous';
      if (!groups[uId]) {
        groups[uId] = {
          user: users.find(u => u.id === uId) || (uId === 'anonymous' ? { name: 'Ẩn danh', avatar: '', role: 'Khách' } : { name: `Thành viên (${uId.slice(0, 6)})`, avatar: '', role: 'Khách' }),
          categories: {},
          totalSize: 0,
          totalCount: 0
        };
      }

      const cat = doc.category || 'others';
      if (!groups[uId].categories[cat]) {
        groups[uId].categories[cat] = [];
      }

      groups[uId].categories[cat].push(doc);
      groups[uId].totalSize += doc.size || 0;
      groups[uId].totalCount += 1;
    });

    return groups;
  }, [documents, users]);

  const categoryNames: Record<string, string> = {
    contracts: 'Hợp đồng (Contracts)',
    projects: 'Dự án (Projects)',
    reports: 'Báo cáo công việc (Task Reports)',
    others: 'Tài liệu khác (Others)'
  };

  // Thống kê tài liệu
  const totalCount = documents.length;
  const totalSize = documents.reduce((acc, curr) => acc + (curr.size || 0), 0);
  const contractsCount = documents.filter(d => d.category === 'contracts').length;
  const projectsCount = documents.filter(d => d.category === 'projects').length;
  const reportsCount = documents.filter(d => d.category === 'reports').length;
  const othersCount = documents.filter(d => d.category === 'others').length;

  return (
    <div className="space-y-6">
      
      {/* Tiêu đề trang */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <FolderOpen className="text-brand-500 w-8 h-8 stroke-[2.2]" />
            Quản lý Tài liệu Hệ thống
          </h1>
          <p className="text-sm font-medium text-gray-400 mt-1">
            Lưu trữ, sắp xếp tài liệu minh chứng đính kèm theo Hợp đồng, Dự án và Báo cáo.
          </p>
        </div>
        <Button onClick={loadDocuments} variant="secondary" className="flex items-center gap-2">
          <RefreshCw size={15} /> Làm mới
        </Button>
      </div>

      {/* Thẻ thống kê */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5 flex items-center gap-4">
          <div className="p-3 bg-brand-50 rounded-2xl text-brand-600 dark:bg-brand-950/20">
            <FolderOpen size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Tổng tài liệu</p>
            <p className="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">{totalCount}</p>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600 dark:bg-emerald-950/20">
            <Database size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Tổng dung lượng</p>
            <p className="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">{formatSize(totalSize)}</p>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4">
          <div className="p-3 bg-blue-50 rounded-2xl text-blue-600 dark:bg-blue-950/20">
            <FileText size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Hợp đồng / Dự án</p>
            <p className="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">
              {contractsCount} HĐ / {projectsCount} DA
            </p>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4">
          <div className="p-3 bg-violet-50 rounded-2xl text-violet-600 dark:bg-violet-950/20">
            <Check size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Báo cáo & Khác</p>
            <p className="text-xl font-extrabold text-gray-900 dark:text-white mt-0.5">
              {reportsCount} Báo cáo / {othersCount} Khác
            </p>
          </div>
        </Card>
      </div>

      {/* Hiển thị lỗi nếu có */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl flex items-center gap-3">
          <Info size={18} className="flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Giao diện chính chia cột */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* CỘT PHẢI: Form Tải tài liệu lên */}
        <Card className="p-6 lg:order-2 space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
            <UploadCloud className="text-brand-500" size={20} />
            Tải lên tài liệu mới
          </h2>

          {uploadSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl flex items-center gap-2">
              <Check size={16} />
              <span className="text-xs font-semibold">{uploadSuccessMsg}</span>
            </div>
          )}

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            
            {/* Phân loại tài liệu */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                1. Phân loại tài liệu
              </label>
              <select 
                value={uploadCategory}
                onChange={(e) => {
                  setUploadCategory(e.target.value);
                  setUploadLinkedId('');
                }}
                className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
              >
                <option value="contracts">Hợp đồng (Contracts)</option>
                <option value="projects">Dự án (Projects)</option>
                <option value="reports">Báo cáo công việc (Task Reports)</option>
                <option value="others">Tài liệu khác</option>
              </select>
            </div>

            {/* Liên kết cụ thể theo Phân loại */}
            {uploadCategory === 'contracts' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  2. Chọn hợp đồng liên kết
                </label>
                <select 
                  value={uploadLinkedId}
                  onChange={(e) => setUploadLinkedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
                  required
                >
                  <option value="">-- Chọn Hợp đồng --</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>
                      [{c.contractNumber}] {c.clientName} - {c.contractName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {uploadCategory === 'projects' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  2. Chọn dự án liên kết
                </label>
                <select 
                  value={uploadLinkedId}
                  onChange={(e) => setUploadLinkedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
                  required
                >
                  <option value="">-- Chọn Dự án --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      [{p.projectCode}] {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {uploadCategory === 'reports' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  2. Chọn báo cáo công việc
                </label>
                <select 
                  value={uploadLinkedId}
                  onChange={(e) => setUploadLinkedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
                  required
                >
                  <option value="">-- Chọn Báo cáo CV --</option>
                  {reports.map(r => (
                    <option key={r.id} value={r.id}>
                      [{r.createdAt.split('T')[0]}] {r.title} ({users.find(u => u.id === r.authorId)?.name || 'Ẩn danh'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Chọn file tải lên */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                {uploadCategory !== 'others' ? '3.' : '2.'} Chọn tệp tải lên
              </label>
              
              <div className="relative border-2 border-dashed border-gray-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 rounded-2xl p-6 text-center cursor-pointer transition-colors group">
                <input 
                  type="file" 
                  multiple
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={uploading}
                />
                <UploadCloud className="mx-auto text-gray-400 group-hover:text-brand-500 transition-colors mb-2" size={32} />
                <p className="text-xs font-bold text-gray-600 dark:text-gray-300">Nhấp hoặc thả nhiều file tại đây</p>
                <p className="text-[10px] text-gray-400 mt-1">Hỗ trợ PDF, Word, Excel, Images tối đa 10MB/file</p>
              </div>
            </div>

            {/* Danh sách file đã chọn */}
            {uploadQueue.length > 0 && (
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Hàng đợi tải lên ({uploadQueue.length})</p>
                {uploadQueue.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
                    <div className="flex items-center gap-2 truncate">
                      <FileText size={14} className="text-brand-500 flex-shrink-0" />
                      <span className="text-xs text-gray-700 dark:text-gray-200 truncate font-medium">{file.name}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">({formatSize(file.size)})</span>
                    </div>
                    <button 
                      type="button"
                      onClick={() => removeFileFromQueue(idx)}
                      className="text-gray-400 hover:text-red-500 p-0.5 transition-colors"
                      disabled={uploading}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full flex items-center justify-center gap-2"
              disabled={uploading || uploadQueue.length === 0}
            >
              {uploading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Đang tải lên ({uploadQueue.length} files)...
                </>
              ) : (
                <>
                  <UploadCloud size={15} />
                  Bắt đầu tải tệp lên
                </>
              )}
            </Button>

          </form>
        </Card>

        {/* CỘT TRÁI (2/3): Bộ lọc và Danh sách tài liệu */}
        <Card className="lg:col-span-2 p-6 lg:order-1 space-y-4">
          
          {/* Thanh chuyển đổi Chế độ xem */}
          <div className="flex border-b border-gray-100 dark:border-slate-800 pb-2 mb-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${
                viewMode === 'list'
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Info size={14} /> Dạng danh sách
            </button>
            <button
              onClick={() => setViewMode('folder')}
              className={`px-4 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${
                viewMode === 'folder'
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <FolderOpen size={14} /> Cấu trúc thư mục
            </button>
          </div>

          {/* Bộ lọc nâng cao */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-gray-50 dark:bg-slate-800/40 p-4 rounded-[1.5rem] border border-gray-100 dark:border-slate-800">
            
            {/* Lọc theo danh mục */}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                Phân loại
              </label>
              <select 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs"
              >
                <option value="all">Tất cả phân loại</option>
                <option value="contracts">Hợp đồng (Contracts)</option>
                <option value="projects">Dự án (Projects)</option>
                <option value="reports">Báo cáo công việc</option>
                <option value="others">Tài liệu khác</option>
              </select>
            </div>

            {/* Lọc theo nhân viên (chỉ Manager/Admin được lọc) */}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                Người tải lên
              </label>
              {canViewAll ? (
                <select 
                  value={createdBy}
                  onChange={(e) => setCreatedBy(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs"
                >
                  <option value="all">Tất cả nhân viên</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
              ) : (
                <input 
                  type="text" 
                  value={user?.name || ''} 
                  disabled 
                  className="w-full px-2.5 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-500 border border-gray-200 dark:border-slate-600 rounded-xl text-xs"
                />
              )}
            </div>

            {/* Lọc theo thực thể liên kết */}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                Mã liên kết
              </label>
              <select 
                value={linkedId}
                onChange={(e) => setLinkedId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs"
              >
                <option value="all">Tất cả liên kết</option>
                {category === 'contracts' && contracts.map(c => (
                  <option key={c.id} value={c.id}>{c.contractNumber}</option>
                ))}
                {category === 'projects' && projects.map(p => (
                  <option key={p.id} value={p.id}>{p.projectCode}</option>
                ))}
                {category === 'reports' && reports.map(r => (
                  <option key={r.id} value={r.id}>{r.title.slice(0, 15)}...</option>
                ))}
              </select>
            </div>

            {/* Tìm kiếm nhanh */}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                Tìm kiếm tên tệp
              </label>
              <div className="relative">
                <input 
                  type="text"
                  placeholder="Nhập và gõ Enter..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-7 pr-2.5 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-xs"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
              </div>
            </div>

          </div>

          {/* Danh sách tài liệu */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 space-y-3">
              <Loader2 className="animate-spin text-brand-500 w-10 h-10" />
              <p className="text-xs font-semibold text-gray-400">Đang tải danh sách tài liệu...</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-gray-100 dark:border-slate-800 rounded-2xl space-y-2">
              <FolderOpen size={40} className="mx-auto text-gray-300" />
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Không tìm thấy tài liệu nào</p>
              <p className="text-xs text-gray-400">Thay đổi bộ lọc hoặc thêm tài liệu mới ở cột bên phải.</p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800 text-gray-400 text-xs font-bold uppercase tracking-wider">
                    <th className="pb-3 pl-2">Tên file / Định dạng</th>
                    <th className="pb-3">Phân loại</th>
                    <th className="pb-3">Kích thước</th>
                    <th className="pb-3">Người tải</th>
                    <th className="pb-3">Thời gian</th>
                    <th className="pb-3 text-right pr-2">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100/50 dark:divide-slate-800/50">
                  {documents.map((doc) => {
                    const { Icon, color } = getFileIconInfo(doc.type);
                    const docUser = users.find(u => u.id === doc.createdBy);
                    
                    // Lấy nhãn liên kết
                    let linkLabel = '';
                    if (doc.category === 'contracts' && doc.linkedId) {
                      const c = contracts.find(item => item.id === doc.linkedId);
                      linkLabel = c ? `HĐ: ${c.contractNumber}` : 'Liên kết HĐ cũ';
                    } else if (doc.category === 'projects' && doc.linkedId) {
                      const p = projects.find(item => item.id === doc.linkedId);
                      linkLabel = p ? `DA: ${p.projectCode}` : 'Liên kết DA cũ';
                    } else if (doc.category === 'reports' && doc.linkedId) {
                      linkLabel = 'Đính kèm Báo cáo';
                    }

                    return (
                      <tr key={doc.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 pl-2 max-w-[200px]">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl flex-shrink-0 ${color}`}>
                              <Icon size={16} />
                            </div>
                            <div className="truncate">
                              <p className="font-semibold text-gray-800 dark:text-gray-100 truncate text-xs" title={doc.name}>
                                {doc.name}
                              </p>
                              {linkLabel && (
                                <span className="inline-flex items-center text-[9px] bg-brand-50 dark:bg-brand-950/20 text-brand-600 dark:text-brand-400 font-bold px-1.5 py-0.5 rounded-full mt-0.5">
                                  {linkLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3">
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                            doc.category === 'contracts' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400' :
                            doc.category === 'projects' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400' :
                            doc.category === 'reports' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400' :
                            'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {doc.category === 'contracts' ? 'Hợp đồng' :
                             doc.category === 'projects' ? 'Dự án' :
                             doc.category === 'reports' ? 'Báo cáo CV' : 'Khác'}
                          </span>
                        </td>

                        <td className="py-3 text-xs text-gray-500 dark:text-gray-400 font-semibold">
                          {formatSize(doc.size)}
                        </td>

                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <Avatar src={docUser?.avatar} alt={docUser?.name} size={5} className="ring-2" />
                            <span className="text-xs text-gray-700 dark:text-gray-200 font-medium truncate max-w-[80px]">
                              {docUser?.name || 'Ẩn danh'}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 text-[11px] text-gray-400 dark:text-gray-500 font-medium">
                          {new Date(doc.createdAt).toLocaleDateString('vi-VN')}
                        </td>

                        <td className="py-3 text-right pr-2">
                          <div className="flex items-center justify-end gap-1.5">
                            
                            {/* Nút tải xuống */}
                            <button
                              type="button"
                              onClick={() => downloadDocumentFile(doc.url, doc.name).catch((e) => setError(e.message))}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 hover:text-gray-800 dark:hover:text-white rounded-lg transition-all"
                              title="Tải tệp"
                            >
                              <Download size={14} />
                            </button>

                            {/* Nút sửa */}
                            <button
                              onClick={() => handleOpenEdit(doc)}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 hover:text-brand-500 rounded-lg transition-all"
                              title="Chỉnh sửa liên kết"
                            >
                              <Edit size={14} />
                            </button>

                            {/* Nút xóa */}
                            <button
                              onClick={() => setDeleteConfirmId(doc.id)}
                              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/20 text-gray-400 hover:text-red-600 rounded-lg transition-all"
                              title="Xóa tài liệu"
                            >
                              <Trash2 size={14} />
                            </button>

                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Folder Tree View */
            <div className="space-y-3">
              {Object.entries(groupedDocuments).length === 0 ? (
                <div className="text-center p-12 border border-dashed border-gray-100 dark:border-slate-800 rounded-2xl space-y-2">
                  <FolderOpen size={40} className="mx-auto text-gray-300" />
                  <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Không tìm thấy thư mục nào</p>
                </div>
              ) : (
                Object.entries(groupedDocuments).map(([uId, group]) => {
                  const isUserExpanded = expandedUsers[uId];
                  return (
                    <div key={uId} className="border border-gray-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900/50 shadow-sm transition-all">
                      {/* USER FOLDER HEADER (Cấp 1) */}
                      <div 
                        onClick={() => toggleUserFolder(uId)}
                        className="flex items-center justify-between p-4 bg-gray-50/50 dark:bg-slate-800/20 hover:bg-gray-100/50 dark:hover:bg-slate-800/40 cursor-pointer select-none transition-colors border-b border-gray-100 dark:border-slate-800"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FolderOpen className="text-amber-500 fill-amber-500/10 flex-shrink-0" size={20} />
                          <Avatar src={group.user?.avatar} alt={group.user?.name} size={6} className="ring-2 ring-white dark:ring-slate-800 flex-shrink-0" />
                          <div className="truncate flex items-center min-w-0 gap-2">
                            <span className="font-bold text-sm text-gray-800 dark:text-gray-200 truncate">
                              {group.user?.name || 'Ẩn danh'}
                            </span>
                            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold px-2 py-0.5 rounded-full flex-shrink-0">
                              {group.user?.role || 'Khách'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-semibold bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                            {group.totalCount} tệp • {formatSize(group.totalSize)}
                          </span>
                          {isUserExpanded ? (
                            <ChevronDown className="text-gray-400" size={16} />
                          ) : (
                            <ChevronRight className="text-gray-400" size={16} />
                          )}
                        </div>
                      </div>

                      {/* SUBFOLDERS LIST (Cấp 2 - Phân loại / Trang) */}
                      {isUserExpanded && (
                        <div className="p-3 bg-white dark:bg-slate-900/10 divide-y divide-gray-50 dark:divide-slate-800/40">
                          {Object.entries(group.categories).map(([catKey, catDocs]) => {
                            const categoryKey = `${uId}_${catKey}`;
                            const isCategoryExpanded = expandedCategories[categoryKey];
                            const catSize = catDocs.reduce((acc, curr) => acc + (curr.size || 0), 0);
                            
                            return (
                              <div key={catKey} className="py-2.5 first:pt-1 last:pb-1">
                                {/* CATEGORY FOLDER HEADER */}
                                <div 
                                  onClick={() => toggleCategoryFolder(categoryKey)}
                                  className="flex items-center justify-between px-3 py-2 bg-slate-50/40 dark:bg-slate-800/10 hover:bg-slate-50 dark:hover:bg-slate-800/20 rounded-xl cursor-pointer select-none transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <FolderOpen className="text-brand-500 fill-brand-500/10 flex-shrink-0" size={18} />
                                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                      {categoryNames[catKey] || catKey}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold bg-slate-100/50 dark:bg-slate-800/40 px-2 py-0.5 rounded-full">
                                      {catDocs.length} tệp • {formatSize(catSize)}
                                    </span>
                                    {isCategoryExpanded ? (
                                      <ChevronDown className="text-gray-400" size={14} />
                                    ) : (
                                      <ChevronRight className="text-gray-400" size={14} />
                                    )}
                                  </div>
                                </div>

                                {/* FILES LIST (Cấp 3 - Tệp tin cụ thể) */}
                                {isCategoryExpanded && (
                                  <div className="mt-2 ml-4 pl-4 border-l border-dashed border-gray-200 dark:border-slate-800 space-y-1.5">
                                    {catDocs.map(doc => {
                                      const { Icon, color } = getFileIconInfo(doc.type);
                                      
                                      let linkLabel = '';
                                      if (doc.category === 'contracts' && doc.linkedId) {
                                        const c = contracts.find(item => item.id === doc.linkedId);
                                        linkLabel = c ? `HĐ: ${c.contractNumber}` : 'HĐ liên kết';
                                      } else if (doc.category === 'projects' && doc.linkedId) {
                                        const p = projects.find(item => item.id === doc.linkedId);
                                        linkLabel = p ? `DA: ${p.projectCode}` : 'DA liên kết';
                                      } else if (doc.category === 'reports' && doc.linkedId) {
                                        linkLabel = 'Đính kèm Báo cáo';
                                      }

                                      return (
                                        <div 
                                          key={doc.id}
                                          className="flex items-center justify-between p-2.5 bg-gray-50/50 dark:bg-slate-800/10 hover:bg-gray-50 dark:hover:bg-slate-800/20 rounded-xl border border-gray-100/20 dark:border-slate-800/20 transition-all hover:translate-x-0.5 duration-200"
                                        >
                                          <div className="flex items-center gap-2.5 min-w-0 pr-4">
                                            <div className={`p-1.5 rounded-lg flex-shrink-0 ${color}`}>
                                              <Icon size={14} />
                                            </div>
                                            <div className="truncate">
                                              <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate" title={doc.name}>
                                                {doc.name}
                                              </p>
                                              <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] text-gray-400 font-semibold">{formatSize(doc.size)}</span>
                                                <span className="text-gray-300 dark:text-slate-800">•</span>
                                                <span className="text-[10px] text-gray-400 font-semibold">{new Date(doc.createdAt).toLocaleDateString('vi-VN')}</span>
                                                {linkLabel && (
                                                  <>
                                                    <span className="text-gray-300 dark:text-slate-800">•</span>
                                                    <span className="text-[9px] bg-brand-50 dark:bg-brand-950/20 text-brand-600 dark:text-brand-400 font-extrabold px-1.5 py-0.5 rounded-full">
                                                      {linkLabel}
                                                    </span>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                              type="button"
                                              onClick={() => downloadDocumentFile(doc.url, doc.name).catch((e) => setError(e.message))}
                                              className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-700 dark:hover:text-white rounded-md transition-colors"
                                              title="Tải tệp"
                                            >
                                              <Download size={13} />
                                            </button>
                                            <button
                                              onClick={() => handleOpenEdit(doc)}
                                              className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-brand-500 rounded-md transition-colors"
                                              title="Sửa"
                                            >
                                              <Edit size={13} />
                                            </button>
                                            <button
                                              onClick={() => setDeleteConfirmId(doc.id)}
                                              className="p-1 hover:bg-red-50 dark:hover:bg-red-950/20 text-gray-400 hover:text-red-600 rounded-md transition-colors"
                                              title="Xóa"
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

        </Card>

      </div>

      {/* Modal Sửa Tài Liệu */}
      {editingDoc && (
        <Modal 
          isOpen={true} 
          onClose={() => setEditingDoc(null)} 
          title="Chỉnh sửa chi tiết tài liệu"
          size="md"
        >
          <form onSubmit={handleSaveEdit} className="space-y-4">
            
            {/* Tên tệp tin */}
            <Input 
              label="Tên tài liệu"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />

            {/* Danh mục tài liệu */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Phân loại tài liệu
              </label>
              <select 
                value={editCategory}
                onChange={(e) => {
                  setEditCategory(e.target.value);
                  setEditLinkedId('');
                }}
                className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
              >
                <option value="contracts">Hợp đồng (Contracts)</option>
                <option value="projects">Dự án (Projects)</option>
                <option value="reports">Báo cáo công việc</option>
                <option value="others">Tài liệu khác</option>
              </select>
            </div>

            {/* Liên kết cụ thể theo Phân loại */}
            {editCategory === 'contracts' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Chọn hợp đồng liên kết
                </label>
                <select 
                  value={editLinkedId}
                  onChange={(e) => setEditLinkedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
                  required
                >
                  <option value="">-- Chọn Hợp đồng --</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>
                      [{c.contractNumber}] {c.clientName} - {c.contractName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {editCategory === 'projects' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Chọn dự án liên kết
                </label>
                <select 
                  value={editLinkedId}
                  onChange={(e) => setEditLinkedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
                  required
                >
                  <option value="">-- Chọn Dự án --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      [{p.projectCode}] {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {editCategory === 'reports' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Chọn báo cáo công việc
                </label>
                <select 
                  value={editLinkedId}
                  onChange={(e) => setEditLinkedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white/60 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none text-sm"
                  required
                >
                  <option value="">-- Chọn Báo cáo CV --</option>
                  {reports.map(r => (
                    <option key={r.id} value={r.id}>
                      [{r.createdAt.split('T')[0]}] {r.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="pt-4 flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
              <Button type="button" variant="secondary" onClick={() => setEditingDoc(null)}>
                Hủy bỏ
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
              </Button>
            </div>

          </form>
        </Modal>
      )}

      {/* Hộp thoại xác nhận xóa tài liệu */}
      <ConfirmDialog 
        isOpen={deleteConfirmId !== null} 
        title="Xóa tài liệu vĩnh viễn"
        message="Hành động này sẽ xóa bản ghi khỏi Cơ sở dữ liệu và xóa tệp vật lý trực tiếp khỏi máy chủ để tiết kiệm dung lượng. Bạn có chắc chắn muốn tiếp tục?"
        confirmText="Đồng ý xóa"
        cancelText="Hủy bỏ"
        type="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirmId(null)}
      />

    </div>
  );
}
