import React, { useState, useEffect } from 'react';
import { 
  FileText, FileSpreadsheet, FileArchive, FileImage, FileCode, File, 
  Trash2, Download, Edit, UploadCloud, Check, Loader2, Info, Plus
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Button, Input, Modal, Avatar } from './UI';
import { ConfirmDialog } from './ConfirmDialog';
import { 
  getDocuments, createDocument, updateDocument, deleteDocument, uploadFiles, downloadDocumentFile, Document
} from '../services/documentService';

interface InlineDocumentManagerProps {
  category: 'contracts' | 'projects' | 'reports';
  linkedId: string;
  readOnly?: boolean;
}

export const InlineDocumentManager: React.FC<InlineDocumentManagerProps> = ({
  category,
  linkedId,
  readOnly = false
}) => {
  const { user } = useAuth();
  const { users } = useData();

  // State
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  // Edit state
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Load documents
  const loadDocuments = async () => {
    if (!linkedId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getDocuments({ category, linkedId });
      setDocuments(data);
    } catch (e: any) {
      setError(e.message || 'Không thể tải danh sách tài liệu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [category, linkedId]);

  // Format file size
  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Get matching icon based on file type
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

  // Drag and drop/select files handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setUploadQueue(prev => [...prev, ...filesArray]);
    }
  };

  const removeFileFromQueue = (index: number) => {
    setUploadQueue(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadQueue.length === 0 || !linkedId) return;

    try {
      setUploading(true);
      setError(null);

      // 1. Upload files to disk using upload API
      const uploadRes = await uploadFiles(uploadQueue, category, linkedId);
      
      // 2. Save metadata to DB
      for (const f of uploadRes.files) {
        await createDocument({
          id: '',
          name: f.name,
          url: f.url,
          size: f.size,
          type: f.type,
          category,
          linkedId
        });
      }

      setUploadSuccessMsg(`Tải lên thành công ${uploadQueue.length} tài liệu!`);
      setUploadQueue([]);
      loadDocuments();

      setTimeout(() => setUploadSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message || 'Lỗi khi tải tệp tin lên server');
    } finally {
      setUploading(false);
    }
  };

  // Edit handler
  const handleOpenEdit = (doc: Document) => {
    setEditingDoc(doc);
    setEditName(doc.name);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDoc) return;

    try {
      setSavingEdit(true);
      await updateDocument(editingDoc.id, {
        name: editName
      });
      setEditingDoc(null);
      loadDocuments();
    } catch (e: any) {
      setError(e.message || 'Lỗi khi cập nhật tài liệu');
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete handler
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

  return (
    <div className="space-y-4">
      {/* Success/Error displays */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
          <Info size={16} className="flex-shrink-0" />
          <span className="text-xs font-semibold">{error}</span>
        </div>
      )}

      {uploadSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl flex items-center gap-2">
          <Check size={16} className="flex-shrink-0" />
          <span className="text-xs font-semibold">{uploadSuccessMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* List of documents */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            Tài liệu đính kèm ({documents.length})
          </h3>
          
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-gray-400">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-xs font-medium">Đang tải danh sách tài liệu...</span>
            </div>
          ) : documents.length === 0 ? (
            <div className="p-6 border border-dashed border-gray-200 dark:border-slate-800 rounded-xl text-center">
              <p className="text-xs font-medium text-gray-400">Chưa có tài liệu nào đính kèm.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {documents.map(doc => {
                const { Icon, color } = getFileIconInfo(doc.type);
                const docUser = users.find(u => u.id === doc.createdBy);
                const isOwnerOrManager = doc.createdBy === user?.id || user?.role === 'Manager' || user?.permissions?.includes('admin_panel');

                return (
                  <div key={doc.id} className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800/40 border border-gray-200 dark:border-slate-800/80 rounded-xl hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-sm transition-all group">
                    <div className="flex items-center gap-3 truncate min-w-0 flex-1">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${color}`}>
                        <Icon size={16} />
                      </div>
                      <div className="truncate min-w-0">
                        <p className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate" title={doc.name}>
                          {doc.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                          <span>{formatSize(doc.size)}</span>
                          <span>•</span>
                          <span>{docUser?.name || 'Ẩn danh'}</span>
                          <span>•</span>
                          <span>{new Date(doc.createdAt).toLocaleDateString('vi-VN')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => downloadDocumentFile(doc.url, doc.name).catch((e) => setError(e.message))}
                        className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title="Tải về"
                      >
                        <Download size={14} />
                      </button>
                      
                      {!readOnly && isOwnerOrManager && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(doc)}
                            className="p-1.5 text-gray-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            title="Sửa tên"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(doc.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            title="Xóa"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Uploader */}
        {!readOnly && (
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              Tải tệp tin lên
            </h3>
            
            <form onSubmit={handleUploadSubmit} className="space-y-3">
              <div className="relative border-2 border-dashed border-gray-200 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 rounded-xl p-4 text-center cursor-pointer transition-colors group">
                <input 
                  type="file" 
                  multiple
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={uploading}
                />
                <UploadCloud className="mx-auto text-gray-400 group-hover:text-brand-500 transition-colors mb-1" size={24} />
                <p className="text-[11px] font-bold text-gray-600 dark:text-gray-300">Nhấp hoặc kéo thả file vào đây</p>
                <p className="text-[9px] text-gray-400 mt-0.5">Tối đa 10MB/file</p>
              </div>

              {uploadQueue.length > 0 && (
                <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                  {uploadQueue.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-1.5 bg-gray-50 dark:bg-slate-800/30 rounded-lg border border-gray-100 dark:border-slate-800">
                      <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate font-semibold flex-1 pr-2">{file.name}</span>
                      <button 
                        type="button"
                        onClick={() => removeFileFromQueue(idx)}
                        className="text-gray-400 hover:text-red-500 p-0.5"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full flex items-center justify-center gap-1.5"
                size="sm"
                disabled={uploading || uploadQueue.length === 0}
              >
                {uploading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Đang tải lên...
                  </>
                ) : (
                  <>
                    <Plus size={12} />
                    Tải tệp lên
                  </>
                )}
              </Button>
            </form>
          </div>
        )}

      </div>

      {/* Edit Modal */}
      {editingDoc && (
        <Modal 
          isOpen={true} 
          onClose={() => setEditingDoc(null)} 
          title="Chỉnh sửa tên tài liệu"
          size="md"
        >
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <Input 
              label="Tên tài liệu mới"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
            <div className="pt-4 flex justify-end gap-2 border-t border-gray-100 dark:border-slate-800">
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

      {/* Delete Confirmation */}
      <ConfirmDialog 
        isOpen={!!deleteConfirmId} 
        title="Xóa tài liệu" 
        message="Bạn có chắc chắn muốn xóa vĩnh viễn tài liệu này khỏi hệ thống?"
        onConfirm={handleDeleteConfirm} 
        onCancel={() => setDeleteConfirmId(null)}
        confirmText="Xóa vĩnh viễn"
        cancelText="Hủy bỏ"
        type="danger"
      />
    </div>
  );
};
