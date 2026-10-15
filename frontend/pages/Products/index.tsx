import React, { useState, useEffect } from 'react';
import { PlusCircle, Search, Edit2, Trash2, X, Save, Package, TrendingUp, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../../components/UI';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import * as productService from '../../services/productService';
import { InventoryTab } from './InventoryTab';
import { HistoryTab } from './HistoryTab';

export default function ProductsPage() {
  const { t } = useLanguage();
  const { contracts } = useData();
  const { user } = useAuth();
  const perms = user?.permissions || [];
  const canManage = perms.includes('manage_warehouse') || perms.includes('admin_panel');
  const [products, setProducts] = useState<productService.Product[]>([]);
  const [activeTab, setActiveTab] = useState<'warehouse' | 'inventory' | 'history'>('warehouse');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ 
    name: '', 
    category: '',
    importCode: '',
    unit: '', 
    origin: '', 
    importQuantity: '',
    importPrice: '',
    salePrice: '',
    invoiceDate: '',
    warrantyMonths: ''
  });
  
  const [batchRows, setBatchRows] = useState<Array<{
    name: string;
    importCode: string;
    unit: string;
    origin: string;
    importQuantity: string;
    importPrice: string;
    salePrice: string;
  }>>([
    { name: '', importCode: '', unit: '', origin: '', importQuantity: '', importPrice: '', salePrice: '' }
  ]);
  const [commonCategory, setCommonCategory] = useState('');
  const [commonInvoiceDate, setCommonInvoiceDate] = useState('');

  const [singleCodeDbError, setSingleCodeDbError] = useState<string | null>(null);
  const [batchCodeDbErrors, setBatchCodeDbErrors] = useState<Array<string | null>>([null]);

  const cursorRef = React.useRef<{ element: HTMLInputElement; digitsBeforeCursor: number } | null>(null);

  React.useLayoutEffect(() => {
    if (cursorRef.current) {
      const { element, digitsBeforeCursor } = cursorRef.current;
      if (document.activeElement === element) {
        const value = element.value;
        let newPos = 0;
        let digitCount = 0;
        while (newPos < value.length && digitCount < digitsBeforeCursor) {
          if (/\d/.test(value[newPos])) {
            digitCount++;
          }
          newPos++;
        }
        element.setSelectionRange(newPos, newPos);
      }
      cursorRef.current = null;
    }
  });

  const handleNumericInputChange = React.useCallback((
    e: React.ChangeEvent<HTMLInputElement>,
    onChange: (val: string) => void
  ) => {
    const input = e.target;
    const rawValue = input.value;
    const cleanValue = rawValue.replace(/\D/g, '');
    const formatted = cleanValue ? Number(cleanValue).toLocaleString('vi-VN') : '';

    const selectionStart = input.selectionStart || 0;

    let digitsBeforeCursor = 0;
    for (let i = 0; i < selectionStart; i++) {
      if (/\d/.test(rawValue[i])) {
        digitsBeforeCursor++;
      }
    }

    cursorRef.current = {
      element: input,
      digitsBeforeCursor
    };

    onChange(formatted);
  }, []);

  // Debounced check-code validation for single edit mode
  useEffect(() => {
    const code = form.importCode.trim();
    if (!code) {
      setSingleCodeDbError(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await productService.checkCode(code, editingId || undefined);
        if (res.exists && res.product) {
          setSingleCodeDbError(`Mã đã tồn tại trong hệ thống (Sản phẩm: "${res.product.name}")`);
        } else {
          setSingleCodeDbError(null);
        }
      } catch (err) {
        console.error(err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [form.importCode, editingId]);

  // Debounced check-code validation for batch creation rows
  useEffect(() => {
    const timer = setTimeout(async () => {
      const updatedErrors = [...batchCodeDbErrors];
      let hasChanges = false;

      const promises = batchRows.map(async (row, index) => {
        const code = row.importCode.trim();
        if (!code) {
          if (batchCodeDbErrors[index] !== null) {
            updatedErrors[index] = null;
            hasChanges = true;
          }
          return;
        }

        try {
          const res = await productService.checkCode(code);
          const errorMsg = res.exists && res.product 
            ? `Mã đã tồn tại trong hệ thống (Sản phẩm: "${res.product.name}")` 
            : null;
          
          if (batchCodeDbErrors[index] !== errorMsg) {
            updatedErrors[index] = errorMsg;
            hasChanges = true;
          }
        } catch (err) {
          console.error(err);
        }
      });

      await Promise.all(promises);
      if (hasChanges) {
        setBatchCodeDbErrors(updatedErrors);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [batchRows]);

  const handleSuggestCode = async (index?: number) => {
    try {
      const res = await productService.suggestCode('NK-');
      const code = res.suggestedCode;
      
      if (index !== undefined) {
        const updated = [...batchRows];
        updated[index] = {
          ...updated[index],
          importCode: code
        };
        setBatchRows(updated);
      } else {
        setForm(prev => ({
          ...prev,
          importCode: code
        }));
      }
    } catch (err) {
      console.error(err);
      alert('Không thể tự động tạo mã từ database.');
    }
  };

  const handleBatchRowChange = (index: number, field: string, value: string) => {
    const updated = [...batchRows];
    let newRow = {
      ...updated[index],
      [field]: value
    };

    if (field === 'name') {
      const trimmedVal = value.trim().toLowerCase();
      const matchedProd = products.find(p => p.name && p.name.trim().toLowerCase() === trimmedVal);
      if (matchedProd) {
        newRow.importCode = matchedProd.importCode || newRow.importCode;
        newRow.unit = matchedProd.unit || newRow.unit;
        newRow.origin = matchedProd.origin || newRow.origin;
        newRow.importPrice = matchedProd.importPrice ? Number(matchedProd.importPrice).toLocaleString('vi-VN') : newRow.importPrice;
        newRow.salePrice = (matchedProd.salePrice || matchedProd.defaultPrice) ? Number(matchedProd.salePrice || matchedProd.defaultPrice).toLocaleString('vi-VN') : newRow.salePrice;
      }
    }

    if (field === 'importCode') {
      const trimmedVal = value.replace(/\s+/g, '').toLowerCase();
      const matchedProd = products.find(p => p.importCode && p.importCode.replace(/\s+/g, '').toLowerCase() === trimmedVal);
      if (matchedProd) {
        newRow.name = matchedProd.name || newRow.name;
        newRow.unit = matchedProd.unit || newRow.unit;
        newRow.origin = matchedProd.origin || newRow.origin;
        newRow.importPrice = matchedProd.importPrice ? Number(matchedProd.importPrice).toLocaleString('vi-VN') : newRow.importPrice;
        newRow.salePrice = (matchedProd.salePrice || matchedProd.defaultPrice) ? Number(matchedProd.salePrice || matchedProd.defaultPrice).toLocaleString('vi-VN') : newRow.salePrice;
      }
    }

    updated[index] = newRow;
    setBatchRows(updated);
  };

  const handleAddBatchRow = () => {
    setBatchRows([
      ...batchRows,
      { name: '', importCode: '', unit: '', origin: '', importQuantity: '', importPrice: '', salePrice: '' }
    ]);
    setBatchCodeDbErrors([...batchCodeDbErrors, null]);
  };

  const handleRemoveBatchRow = (index: number) => {
    if (batchRows.length <= 1) return;
    setBatchRows(batchRows.filter((_, i) => i !== index));
    setBatchCodeDbErrors(batchCodeDbErrors.filter((_, i) => i !== index));
  };

  const uniqueProductNames = Array.from(new Set(products.map(p => p.name).filter(Boolean)));
  const uniqueUnits = Array.from(new Set(products.map(p => p.unit).filter(Boolean)));
  const uniqueOrigins = Array.from(new Set(products.map(p => p.origin).filter(Boolean)));
  const uniqueProductSkus = Array.from(new Set(products.map(p => p.importCode).filter(Boolean)));

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const data = await productService.getProducts();
      setProducts(data);
    } catch (error) {
      console.error('Failed to load products', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const calculateRemaining = (p: productService.Product) => {
    const importQty = Number(p.importQuantity) || 0;

    if (p.importCode) {
      // Find all output contracts that sold/exported/invoiced from this specific lot p
      let totalSold = 0;
      contracts
        .filter(c => c.contractType === 'output' && c.status !== 'cancelled')
        .forEach(c => {
          (c.products || []).forEach(cp => {
            // Check if this sold item explicitly links to this specific warehouse lot
            const matchesLot =
              (cp.sourceProductId && cp.sourceProductId === p.id) ||
              (cp.importCode && cp.importCode === p.importCode);

            // Fallback for legacy data: match by name if the output contract c is linked to this lot's source input contract
            let matchesFallback = false;
            if (!matchesLot && cp.name?.trim().toLowerCase() === p.name.trim().toLowerCase()) {
              const baseCode = p.importCode?.replace(/-\d+$/, '').trim();
              const srcContract = contracts.find(ic => ic.contractType === 'input' && ic.contractNumber?.trim() === baseCode);
              if (srcContract && c.linkedInputContractIds?.includes(srcContract.id)) {
                matchesFallback = true;
              }
            }

            if (matchesLot || matchesFallback) {
              totalSold += (cp.invoicedQuantity || cp.exportedQuantity || 0);
            }
          });
        });

      return importQty - totalSold;
    }

    // Catalog entry (no importCode): subtract from output-only contracts
    const exportQty = contracts
      .filter(c => c.contractType !== 'input' && c.status !== 'cancelled')
      .flatMap(c => c.products || [])
      .filter(cp => cp.name?.trim().toLowerCase() === p.name?.trim().toLowerCase())
      .reduce((sum, cp) => sum + (Number(cp.invoicedQuantity) || Number(cp.exportedQuantity) || 0), 0);
    return importQty - exportQty;
  };


  const getSingleEditCodeError = () => {
    const val = form.importCode.replace(/\s+/g, '').toLowerCase();
    if (!val) return null;
    const exists = products.some(p => {
      if (p.id === editingId || !p.importCode) return false;
      return p.importCode.replace(/\s+/g, '').toLowerCase() === val;
    });
    if (exists) return 'Mã nhập kho đã tồn tại trong hệ thống';
    return null;
  };

  const getBatchRowCodeError = (index: number) => {
    const row = batchRows[index];
    if (!row) return null;
    const val = row.importCode.replace(/\s+/g, '').toLowerCase();
    if (!val) return null;

    // Check duplicate in same batch list
    const duplicateInBatch = batchRows.some((r, i) => {
      if (i === index || !r.importCode) return false;
      return r.importCode.replace(/\s+/g, '').toLowerCase() === val;
    });
    if (duplicateInBatch) return 'Trúng lặp với dòng khác';

    // Check duplicate against DB
    const existsInDb = products.some(p => {
      if (!p.importCode) return false;
      return p.importCode.replace(/\s+/g, '').toLowerCase() === val;
    });
    if (existsInDb) return 'Mã đã tồn tại trong hệ thống';

    return null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingId) {
        if (!form.name.trim()) return;
        const importPriceNum = Number(form.importPrice.replace(/\D/g, '')) || 0;
        const salePriceNum = Number(form.salePrice.replace(/\D/g, '')) || 0;
        if (salePriceNum <= importPriceNum) {
          alert('Giá bán gợi ý không được bằng hoặc nhỏ hơn giá nhập (giá mua)!');
          return;
        }

        const formImportCode = form.importCode.trim();
        if (formImportCode) {
          const isDuplicate = products.some(p => p.id !== editingId && p.importCode && p.importCode.trim().toLowerCase() === formImportCode.toLowerCase());
          if (isDuplicate) {
            alert(`Mã nhập kho '${formImportCode}' đã tồn tại trong hệ thống! Vui lòng chọn mã khác.`);
            return;
          }
        }

        const payload = {
          name: form.name.trim(),
          category: form.category.trim(),
          importCode: formImportCode,
          unit: form.unit.trim(),
          origin: form.origin.trim(),
          importQuantity: Number(form.importQuantity.replace(/\D/g, '')) || 0,
          importPrice: importPriceNum,
          salePrice: salePriceNum,
          invoiceDate: form.invoiceDate ? form.invoiceDate.trim() : null,
          warrantyMonths: Math.min(Math.max(Number(form.warrantyMonths) || 0, 0), 1200)
        };

        await productService.updateProduct(editingId, payload as any);
      } else {
        // Validate batch creation rows
        if (batchRows.length === 0) return;

        const productsPayload = batchRows.map(row => {
          const importPriceNum = Number(row.importPrice.replace(/\D/g, '')) || 0;
          const salePriceNum = Number(row.salePrice.replace(/\D/g, '')) || 0;
          return {
            name: row.name.trim(),
            category: commonCategory.trim(),
            importCode: row.importCode.trim(),
            unit: row.unit.trim(),
            origin: row.origin.trim(),
            importQuantity: Number(row.importQuantity.replace(/\D/g, '')) || 0,
            importPrice: importPriceNum,
            salePrice: salePriceNum,
            invoiceDate: commonInvoiceDate ? commonInvoiceDate.trim() : null
          };
        });

        // Run validation on all batch products
        const codesInBatch = new Set<string>();
        for (let i = 0; i < productsPayload.length; i++) {
          const p = productsPayload[i];
          if (!p.name) {
            alert(`Sản phẩm dòng ${i + 1} chưa nhập tên!`);
            return;
          }
          if (p.importQuantity <= 0) {
            alert(`Sản phẩm dòng ${i + 1} ("${p.name}"): Số lượng nhập phải lớn hơn 0!`);
            return;
          }
          if (p.salePrice <= p.importPrice) {
            alert(`Sản phẩm dòng ${i + 1} ("${p.name}"): Giá bán gợi ý không được bằng hoặc nhỏ hơn giá nhập (giá mua)!`);
            return;
          }

          if (p.importCode) {
            const lowerCode = p.importCode.toLowerCase();
            // Check duplicate in same batch
            if (codesInBatch.has(lowerCode)) {
              alert(`Mã nhập kho '${p.importCode}' bị trùng lặp ở dòng ${i + 1}! Vui lòng nhập các mã nhập kho khác nhau.`);
              return;
            }
            codesInBatch.add(lowerCode);

            // Check duplicate against DB (pre-loaded list)
            const existingProduct = products.find(existing => existing.importCode && existing.importCode.trim().toLowerCase() === lowerCode);
            if (existingProduct) {
              alert(`Mã nhập kho '${p.importCode}' đã tồn tại trong hệ thống (sản phẩm '${existingProduct.name}')! Vui lòng chọn mã khác.`);
              return;
            }
          }
        }

        await productService.createProductsBatch(productsPayload as any);
      }
      
      closeModal();
      loadProducts();
    } catch (error: any) {
      alert(error.message || 'Có lỗi xảy ra');
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ name: '', category: '', importCode: '', unit: '', origin: '', importQuantity: '', importPrice: '', salePrice: '', invoiceDate: '', warrantyMonths: '' });
    setBatchRows([
      { name: '', importCode: '', unit: '', origin: '', importQuantity: '', importPrice: '', salePrice: '' }
    ]);
    setSingleCodeDbError(null);
    setBatchCodeDbErrors([null]);
    setCommonCategory('');
    setCommonInvoiceDate('');
    setIsModalOpen(true);
  };

  const handleEdit = (p: productService.Product) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      category: p.category || '',
      importCode: p.importCode || '',
      unit: p.unit || '',
      origin: p.origin || '',
      importQuantity: p.importQuantity ? Number(p.importQuantity).toLocaleString('vi-VN') : '',
      importPrice: p.importPrice ? Number(p.importPrice).toLocaleString('vi-VN') : '',
      salePrice: (p.salePrice || p.defaultPrice) ? Number(p.salePrice || p.defaultPrice).toLocaleString('vi-VN') : '',
      invoiceDate: p.invoiceDate || '',
      warrantyMonths: p.warrantyMonths !== undefined && p.warrantyMonths !== null ? String(p.warrantyMonths) : ''
    });
    setSingleCodeDbError(null);
    setBatchCodeDbErrors([null]);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setForm({ name: '', category: '', importCode: '', unit: '', origin: '', importQuantity: '', importPrice: '', salePrice: '', invoiceDate: '', warrantyMonths: '' });
    setSingleCodeDbError(null);
    setBatchCodeDbErrors([null]);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await productService.deleteProduct(deleteId);
      setDeleteId(null);
      loadProducts();
    } catch (error) {
      console.error('Failed to delete product', error);
      alert('Lỗi khi xóa sản phẩm');
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.category?.toLowerCase().includes(search.toLowerCase()) ||
    p.importCode?.toLowerCase().includes(search.toLowerCase()) ||
    p.origin?.toLowerCase().includes(search.toLowerCase())
  );

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    const codeA = a.importCode ? a.importCode.trim() : '';
    const codeB = b.importCode ? b.importCode.trim() : '';
    
    // Put empty/null SKU codes at the bottom
    if (!codeA && codeB) return 1;
    if (codeA && !codeB) return -1;
    if (!codeA && !codeB) return 0;
    
    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  });

  const totalInventoryValue = products.reduce((sum, p) => sum + (calculateRemaining(p) * (p.importPrice || 0)), 0);
  const lowStockProducts = products.filter(p => {
    const r = calculateRemaining(p);
    return r > 0 && r <= 5;
  }).length;
  const outOfStockProducts = products.filter(p => calculateRemaining(p) <= 0).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <Package className="text-emerald-500" /> Quản lý Xuất/Nhập Kho
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">Quản lý hàng hóa, kiểm soát tồn kho và theo dõi giá vốn/bán</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {/* Bộ chuyển Tab */}
          <button 
            onClick={() => setActiveTab('warehouse')}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              activeTab === 'warehouse' 
                ? 'bg-emerald-600 text-white shadow-sm' 
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
            }`}
          >
            📦 Danh sách kho
          </button>
          <button 
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              activeTab === 'inventory' 
                ? 'bg-emerald-600 text-white shadow-sm' 
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
            }`}
          >
            📦 Hàng phân bổ
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              activeTab === 'history' 
                ? 'bg-emerald-600 text-white shadow-sm' 
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
            }`}
          >
            📜 Lịch sử xuất hóa đơn
          </button>

          {activeTab === 'warehouse' && (
            canManage ? (
              <button onClick={openCreateModal} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-sm ml-2">
                <PlusCircle size={16} />
                Nhập kho
              </button>
            ) : (
              <div className="px-4 py-2 bg-gray-100 text-gray-500 rounded-xl font-bold flex items-center gap-2 text-sm border border-gray-200 ml-2">
                <AlertCircle size={16} /> Chỉ xem
              </div>
            )
          )}
        </div>
      </div>

      {activeTab === 'warehouse' ? (
        <>
          {/* Thống kê nhanh */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4 flex items-center gap-4 border-l-4 border-emerald-500">
              <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                <Package size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-500 uppercase">Tổng mặt hàng</p>
                <p className="text-2xl font-black text-gray-800">{products.length}</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-4 border-l-4 border-blue-500">
              <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                <TrendingUp size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-500 uppercase">Tổng giá trị tồn kho</p>
                <p className="text-2xl font-black text-gray-800">{totalInventoryValue.toLocaleString('vi-VN')} ₫</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-4 border-l-4 border-amber-500">
              <div className="p-3 bg-amber-100 text-amber-600 rounded-xl">
                <AlertCircle size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-500 uppercase">Sắp hết hàng</p>
                <p className="text-2xl font-black text-amber-600">{lowStockProducts}</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-4 border-l-4 border-rose-500">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-xl">
                <X size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-500 uppercase">Hết hàng</p>
                <p className="text-2xl font-black text-rose-600">{outOfStockProducts}</p>
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden flex flex-col min-h-[600px]">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input type="text" placeholder="Tìm kiếm tên, mã kho, số hóa đơn đầu vào..." value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 focus:ring-2 focus:ring-emerald-500 focus:bg-white dark:focus:bg-slate-700 text-gray-800 dark:text-slate-100" />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-12 text-center">STT</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Mã NK</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Sản phẩm</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Hóa đơn / Ngày xuất</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase text-center w-20">SL Nhập</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase text-center w-20">Tồn kho</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase text-right">Giá nhập</th>
                    <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase text-right">Giá bán</th>
                    {canManage && <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase text-center w-24">Thao tác</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {loading ? (
                    <tr><td colSpan={8} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                  ) : sortedProducts.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-gray-400">Không tìm thấy hàng hóa nào.</td></tr>
                  ) : (
                    sortedProducts.map((p, idx) => {
                      const remain = calculateRemaining(p);
                      return (
                        <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="p-3 text-sm text-gray-500 dark:text-slate-400 text-center">{idx + 1}</td>
                          <td className="p-3 text-sm font-semibold text-gray-700 dark:text-slate-300">{p.importCode || '-'}</td>
                          <td className="p-3">
                            <p className="text-sm font-bold text-gray-800 dark:text-slate-200">{p.name}</p>
                            <p className="text-xs text-gray-500">{p.origin || '-'} | ĐVT: {p.unit || '-'}</p>
                          </td>
                          <td className="p-3 text-sm font-medium text-gray-600 dark:text-slate-400">
                            <div>{p.category || '-'}</div>
                            {p.invoiceDate && <div className="text-[11px] text-gray-400 font-normal mt-0.5">Ngày HĐ: {p.invoiceDate}</div>}
                          </td>
                          <td className="p-3 text-center text-sm font-bold text-gray-600">
                            {p.importQuantity ? p.importQuantity.toLocaleString('vi-VN') : '0'}
                          </td>
                          <td className="p-3 text-center">
                            {remain <= 0 ? (
                              <span className="px-2 py-1 bg-rose-100 text-rose-700 rounded font-bold text-xs whitespace-nowrap">Hết hàng (0)</span>
                            ) : remain <= 5 ? (
                              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded font-bold text-xs">{remain}</span>
                            ) : (
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded font-bold text-xs">{remain}</span>
                            )}
                          </td>
                          <td className="p-3 text-sm font-semibold text-gray-500 text-right">{p.importPrice ? p.importPrice.toLocaleString('vi-VN') : '-'}</td>
                          <td className="p-3 text-sm font-bold text-emerald-600 text-right">{(p.salePrice || p.defaultPrice) ? (p.salePrice || p.defaultPrice)?.toLocaleString('vi-VN') : '-'}</td>
                          {canManage && (
                            <td className="p-3 text-center">
                              <div className="flex justify-center gap-1">
                                <button onClick={() => handleEdit(p)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Sửa">
                                  <Edit2 size={16} />
                                </button>
                                <button onClick={() => setDeleteId(p.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Xóa">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : activeTab === 'inventory' ? (
        <InventoryTab contracts={contracts} products={products} />
      ) : (
        <HistoryTab contracts={contracts} products={products} />
      )}

      <ConfirmDialog isOpen={!!deleteId} title="Xóa sản phẩm" message="Bạn có chắc chắn muốn xóa sản phẩm này khỏi danh mục?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} type="danger" />

      {/* Modal Thêm/Sửa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity duration-300">
          <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full ${editingId ? 'max-w-2xl' : 'max-w-6xl'} overflow-hidden flex flex-col max-h-[90vh] transition-all duration-300`}>
            <div className="p-5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                <Package className="text-emerald-500 animate-pulse" />
                {editingId ? 'Cập nhật hàng hóa' : 'Nhập kho hàng loạt'}
              </h2>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            {editingId ? (
              // EDIT MODE Form
              <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">TÊN SẢN PHẨM *</label>
                    <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="VD: Tấm pin AIKO Neostar 2S+ 455W / Inverter SAJ..."
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5 flex justify-between items-center">
                      <span>MÃ NHẬP KHO (SKU)</span>
                      <button 
                        type="button" 
                        onClick={() => handleSuggestCode()} 
                        className="text-xs font-extrabold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors"
                      >
                        ⚡ Đề xuất mã
                      </button>
                    </label>
                    <input 
                      list="product-skus-list"
                      value={form.importCode} 
                      onChange={e => setForm({...form, importCode: e.target.value})} 
                      placeholder="VD: AIKO-455-N"
                      className={`w-full px-4 py-2.5 border rounded-xl focus:ring-2 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 font-medium ${
                        (getSingleEditCodeError() || singleCodeDbError)
                          ? 'border-rose-500 focus:ring-rose-500 focus:border-rose-500 bg-rose-50/5'
                          : 'border-gray-200 dark:border-slate-600 focus:ring-emerald-500'
                      }`} 
                    />
                    {(getSingleEditCodeError() || singleCodeDbError) && (
                      <p className="text-[11px] text-rose-500 font-bold mt-1">⚠️ {singleCodeDbError || getSingleEditCodeError()}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">ĐƠN VỊ TÍNH</label>
                    <input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} placeholder="VD: Cái, Bộ"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">SỐ HÓA ĐƠN ĐẦU VÀO</label>
                    <input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="VD: HD-0001234..."
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">NGÀY XUẤT HÓA ĐƠN</label>
                    <input type="date" value={form.invoiceDate} onChange={e => setForm({...form, invoiceDate: e.target.value})}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">XUẤT XỨ</label>
                    <input value={form.origin} onChange={e => setForm({...form, origin: e.target.value})} placeholder="VD: VN"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">SỐ LƯỢNG TỔNG (NHẬP KHO)</label>
                    <input 
                      value={form.importQuantity || ''} 
                      onChange={e => handleNumericInputChange(e, val => setForm({...form, importQuantity: val}))} 
                      placeholder="0"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-center font-bold text-blue-600" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">GIÁ NHẬP / GIÁ VỐN (VNĐ)</label>
                    <input 
                      value={form.importPrice || ''} 
                      onChange={e => handleNumericInputChange(e, val => setForm({...form, importPrice: val}))} 
                      placeholder="1.000.000"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-right" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">GIÁ BÁN GỢI Ý (VNĐ)</label>
                    <input 
                      value={form.salePrice || ''} 
                      onChange={e => handleNumericInputChange(e, val => setForm({...form, salePrice: val}))} 
                      placeholder="1.200.000"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-right font-bold text-emerald-600" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5">BẢO HÀNH (THÁNG)</label>
                    <input
                      type="number" min={0} max={1200}
                      value={form.warrantyMonths}
                      onChange={e => setForm({...form, warrantyMonths: e.target.value})}
                      placeholder="VD: 24"
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-right"
                    />
                  </div>
                </div>

                <div className="pt-6 flex gap-3 border-t border-gray-100 dark:border-slate-700 mt-6">
                  <button type="button" onClick={closeModal} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-colors">
                    Hủy bỏ
                  </button>
                  <button type="submit" disabled={!form.name || !!getSingleEditCodeError() || !!singleCodeDbError} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30">
                    <Save size={20} /> Cập nhật
                  </button>
                </div>
              </form>
            ) : (
              // BATCH CREATE MODE Form
              <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5">
                {/* Common fields info */}
                <div className="bg-emerald-50/50 dark:bg-slate-700/30 p-4 rounded-xl border border-emerald-100/50 dark:border-slate-700 grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                      Số hóa đơn đầu vào
                    </label>
                    <input 
                      value={commonCategory} 
                      onChange={e => setCommonCategory(e.target.value)} 
                      placeholder="VD: HD-0001234..."
                      className="w-full px-4 py-2 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-100 font-medium" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                      Ngày xuất hóa đơn
                    </label>
                    <input 
                      type="date"
                      value={commonInvoiceDate} 
                      onChange={e => setCommonInvoiceDate(e.target.value)} 
                      className="w-full px-4 py-2 border border-gray-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-100" 
                    />
                  </div>
                </div>

                {/* Batch rows table */}
                <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-10 text-center">#</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-56">Tên sản phẩm *</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-36">Mã SKU (Mã NK)</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-24">ĐVT</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-24">Xuất xứ</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-28 text-center">SL Nhập *</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-32 text-right">Giá nhập (VNĐ)</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-32 text-right">Giá bán gợi ý *</th>
                        <th className="p-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase w-12 text-center">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                      {batchRows.map((row, index) => (
                        <tr key={index} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20">
                          <td className="p-2 text-center text-sm font-medium text-gray-400">{index + 1}</td>
                          <td className="p-2">
                            <input 
                              required
                              list="product-names-list"
                              value={row.name}
                              onChange={e => handleBatchRowChange(index, 'name', e.target.value)}
                              placeholder="Nhập hoặc chọn tên..."
                              className="w-full px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-sm"
                            />
                          </td>
                          <td className="p-2">
                            <div className="relative flex items-center">
                              <input 
                                list="product-skus-list"
                                value={row.importCode}
                                onChange={e => handleBatchRowChange(index, 'importCode', e.target.value)}
                                placeholder="Mã SKU"
                                className={`w-full pl-2 pr-8 py-1.5 border rounded-lg focus:ring-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-sm font-medium ${
                                  (getBatchRowCodeError(index) || batchCodeDbErrors[index])
                                    ? 'border-rose-500 focus:ring-rose-500 focus:border-rose-500 bg-rose-500/5'
                                    : 'border-gray-200 dark:border-slate-600 focus:ring-emerald-500'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => handleSuggestCode(index)}
                                className="absolute right-1 px-1.5 py-0.5 text-xs font-black text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
                                title="⚡ Tự động đề xuất mã từ DB"
                              >
                                ⚡
                              </button>
                            </div>
                            {(getBatchRowCodeError(index) || batchCodeDbErrors[index]) && (
                              <p className="text-[10px] text-rose-500 font-bold mt-0.5 leading-none">
                                ⚠️ {getBatchRowCodeError(index) || batchCodeDbErrors[index]}
                              </p>
                            )}
                          </td>
                          <td className="p-2">
                            <input 
                              list="product-units-list"
                              value={row.unit}
                              onChange={e => handleBatchRowChange(index, 'unit', e.target.value)}
                              placeholder="Cái, Bộ..."
                              className="w-full px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-sm"
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              list="product-origins-list"
                              value={row.origin}
                              onChange={e => handleBatchRowChange(index, 'origin', e.target.value)}
                              placeholder="VN, Trung Quốc..."
                              className="w-full px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-sm"
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              value={row.importQuantity || ''}
                              onChange={e => handleNumericInputChange(e, val => handleBatchRowChange(index, 'importQuantity', val))}
                              placeholder="0"
                              className="w-full px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-150 text-center font-bold text-sm text-blue-600"
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              value={row.importPrice || ''}
                              onChange={e => handleNumericInputChange(e, val => handleBatchRowChange(index, 'importPrice', val))}
                              placeholder="Giá mua"
                              className="w-full px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-right text-sm"
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              value={row.salePrice || ''}
                              onChange={e => handleNumericInputChange(e, val => handleBatchRowChange(index, 'salePrice', val))}
                              placeholder="Giá bán"
                              className="w-full px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 text-right font-bold text-sm text-emerald-600"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <button 
                              type="button"
                              disabled={batchRows.length <= 1}
                              onClick={() => handleRemoveBatchRow(index)}
                              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors disabled:opacity-30"
                              title="Xóa dòng"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex justify-between items-center">
                  <button 
                    type="button" 
                    onClick={handleAddBatchRow}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-slate-700 dark:hover:bg-slate-600 text-emerald-700 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-200 dark:border-slate-600 transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <PlusCircle size={14} /> Thêm sản phẩm
                  </button>
                  <span className="text-xs text-gray-400">Tổng cộng: {batchRows.length} dòng sản phẩm</span>
                </div>

                <div className="pt-6 flex gap-3 border-t border-gray-100 dark:border-slate-700 mt-6">
                  <button type="button" onClick={closeModal} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-colors">
                    Hủy bỏ
                  </button>
                  <button 
                    type="submit" 
                    disabled={batchRows.some((_, i) => !!getBatchRowCodeError(i) || !!batchCodeDbErrors[i])} 
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30"
                  >
                    <Save size={20} /> Lưu vào kho ({batchRows.length} sản phẩm)
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Autocomplete Datalists */}
      <datalist id="product-names-list">
        {uniqueProductNames.map(name => <option key={name} value={name} />)}
      </datalist>
      <datalist id="product-units-list">
        {uniqueUnits.map(unit => <option key={unit} value={unit} />)}
      </datalist>
      <datalist id="product-origins-list">
        {uniqueOrigins.map(origin => <option key={origin} value={origin} />)}
      </datalist>
      <datalist id="product-skus-list">
        {uniqueProductSkus.map(code => <option key={code} value={code} />)}
      </datalist>
    </div>
  );
}
