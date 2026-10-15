import { apiFetch } from './api';

export interface Product {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  origin?: string;
  defaultPrice?: number; // legacy
  importQuantity?: number;
  remainingQuantity?: number;
  importPrice?: number;
  salePrice?: number;
  importCode?: string;
  invoiceDate?: string;
  warrantyMonths?: number;
  createdAt: string;
}

export const getProducts = async (): Promise<Product[]> => {
  const res = await apiFetch('/api/products');
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
};

export const createProduct = async (product: Omit<Product, 'id' | 'createdAt'>): Promise<Product> => {
  const res = await apiFetch('/api/products', {
    method: 'POST',
    body: JSON.stringify(product),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to create product');
  }
  return res.json();
};

export const createProductsBatch = async (products: Omit<Product, 'id' | 'createdAt'>[]): Promise<Product[]> => {
  const res = await apiFetch('/api/products', {
    method: 'POST',
    body: JSON.stringify(products),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to create products batch');
  }
  return res.json();
};

export const updateProduct = async (id: string, product: Omit<Product, 'id' | 'createdAt'>): Promise<Product> => {
  const res = await apiFetch(`/api/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(product),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to update product');
  }
  return res.json();
};

export const deleteProduct = async (id: string): Promise<void> => {
  const res = await apiFetch(`/api/products/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete product');
};

export const checkCode = async (code: string, excludeId?: string): Promise<{ exists: boolean; product?: { id: string; name: string } }> => {
  const query = new URLSearchParams({ code, excludeId: excludeId || '' }).toString();
  const res = await apiFetch(`/api/products/check-code?${query}`);
  if (!res.ok) throw new Error('Failed to check product code');
  return res.json();
};

export const suggestCode = async (prefix?: string): Promise<{ suggestedCode: string }> => {
  const query = new URLSearchParams({ prefix: prefix || 'NK-' }).toString();
  const res = await apiFetch(`/api/products/suggest-code?${query}`);
  if (!res.ok) throw new Error('Failed to suggest product code');
  return res.json();
};
