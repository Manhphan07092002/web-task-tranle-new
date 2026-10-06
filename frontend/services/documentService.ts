import { apiFetch } from './api';

const API_URL = '/api/documents';

export interface Document {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  category: string; // 'contracts' | 'projects' | 'reports' | 'others'
  linkedId?: string; // ID of contract, project, or report
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  isDeleted?: number;
}

export interface GetDocumentsParams {
  createdBy?: string;
  category?: string;
  linkedId?: string;
  search?: string;
}

export const getDocuments = async (params: GetDocumentsParams = {}): Promise<Document[]> => {
  const query = new URLSearchParams();
  if (params.createdBy) query.append('createdBy', params.createdBy);
  if (params.category) query.append('category', params.category);
  if (params.linkedId) query.append('linkedId', params.linkedId);
  if (params.search) query.append('search', params.search);

  const queryString = query.toString() ? `?${query.toString()}` : '';
  const res = await apiFetch(`${API_URL}${queryString}`);
  if (!res.ok) throw new Error('Không thể tải danh sách tài liệu');
  return res.json();
};

export const createDocument = async (doc: Omit<Document, 'createdBy' | 'createdAt'>): Promise<{ id: string }> => {
  const res = await apiFetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi lưu thông tin tài liệu');
  }
  return res.json();
};

export const updateDocument = async (id: string, doc: Partial<Document>): Promise<void> => {
  const res = await apiFetch(`${API_URL}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi cập nhật tài liệu');
  }
};

export const deleteDocument = async (id: string): Promise<void> => {
  const res = await apiFetch(`${API_URL}/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi xóa tài liệu');
  }
};

// Hàm tải lên tệp tin sử dụng API upload hiện có của server
export const uploadFiles = async (files: File[], entityType?: 'contracts' | 'projects' | 'reports', entityId?: string): Promise<{ files: { name: string; url: string; size: number; type: string }[] }> => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });
  if (entityType && entityId) {
    formData.append('entityType', entityType);
    formData.append('entityId', entityId);
  }

  const res = await apiFetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi tải tệp tin lên server');
  }

  return res.json();
};

export const downloadDocumentFile = async (url: string, filename: string): Promise<void> => {
  const res = await apiFetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Không thể tải tệp');
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
};
