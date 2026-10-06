import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/UI';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PlusCircle, Search, FileText, Filter, Download, CheckCircle2, AlertCircle, X, AlertTriangle } from 'lucide-react';
import { Contract, ContractProduct, ContractType, DocumentChecklist } from '../../services/contractService';
import { apiFetch } from '../../services/api';
import { exportXlsx } from '../../utils/exportXlsx';
import * as productService from '../../services/productService';
import { PaymentModal } from './PaymentModal';
import { useReactToPrint } from 'react-to-print';
import { PrintableQuote } from './PrintableQuote';
import { ExportStockModal } from './ExportStockModal';
import { ExportInvoiceModal } from './ExportInvoiceModal';
import { ContractLinksTab } from './ContractLinksTab';
import { ContractCharts } from './ContractCharts';

// Sub-components
import { ContractMetrics } from './ContractMetrics';
import { ContractTable } from './ContractTable';
import { ContractDebtTable } from './ContractDebtTable';
import { ContractForm } from './ContractForm';

// Toast notification types
interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

const ContractsPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const contractIdParam = searchParams.get('contractId');
  const { contracts, clients, users, departments, tasks, projects, saveContract, deleteContract } = useData();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDebt, setFilterDebt] = useState('all');
  const [debtType, setDebtType] = useState<'output' | 'input'>('output');
  const [historyType, setHistoryType] = useState<'output' | 'input'>('output');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [formDirty, setFormDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'output' | 'input' | 'debts' | 'links' | 'create' | 'history'>(() => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    if (tabParam && ['output', 'input', 'debts', 'links', 'create', 'history'].includes(tabParam)) {
      return tabParam as any;
    }
    return 'output';
  });
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [paymentContract, setPaymentContract] = useState<Contract | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({ name: '', unit: '', quantity: '1', origin: '', unitPrice: '', vatRate: '8' });
  const [editingProductIdx, setEditingProductIdx] = useState<number | null>(null);
  const [exportStockContract, setExportStockContract] = useState<Contract | null>(null);
  const [exportInvoiceContract, setExportInvoiceContract] = useState<Contract | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [readOnlyContract, setReadOnlyContract] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const itemsPerPage = 20;
  const [showCharts, setShowCharts] = useState(false);

  // Toast notification helper
  const showToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const switchTab = useCallback((tab: typeof activeTab) => {
    if (activeTab === 'create' && formDirty && tab !== 'create') {
      setPendingTab(tab);
      return;
    }
    setActiveTab(tab);
    setSearchParams(prev => {
      prev.set('tab', tab);
      return prev;
    });
  }, [activeTab, formDirty, setSearchParams]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['output', 'input', 'debts', 'links', 'create', 'history'].includes(tabParam)) {
      setActiveTab(tabParam as any);
    }
  }, [searchParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterStatus, filterDebt, debtType, historyType, activeTab, dateFrom, dateTo]);

  // Form state
  const [form, setForm] = useState<{
    id?: string;
    contractNumber: string;
    clientName: string;
    contractName: string;
    preTaxValue: number;
    vatRate: number;
    postTaxValue: number;
    invoiceDate: string;
    invoiceNumber: string;
    products: ContractProduct[];
    status: string;
    attachments: string[];
    paidAmount: number;
    projectId: string;
    contractType: ContractType;
    supplierName: string;
    documentChecklist: DocumentChecklist;
    linkedInputContractIds?: string[];
    signedDate?: string;
    startDate?: string;
    endDate?: string;
    warrantyMonths?: number;
    payments?: any[];
    docSentDate?: string;
    docReceivedDate?: string;
    docAccountantDate?: string;
    docReceiver?: string;
    docAccountantUserId?: string;
    docAccountantStatus?: string;
    department?: string;
  }>({
    id: '',
    contractNumber: '',
    clientName: '',
    contractName: '',
    preTaxValue: 0,
    vatRate: 10,
    postTaxValue: 0,
    invoiceDate: '',
    invoiceNumber: '',
    products: [],
    status: 'draft',
    attachments: [],
    paidAmount: 0,
    projectId: '',
    contractType: 'output',
    supplierName: '',
    documentChecklist: {},
    signedDate: '',
    startDate: '',
    endDate: '',
    warrantyMonths: 0,
    payments: [],
    docSentDate: '',
    docReceivedDate: '',
    docAccountantDate: '',
    docReceiver: '',
    docAccountantUserId: '',
    docAccountantStatus: '',
    department: ''
  });
  const [uploading, setUploading] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<productService.Product[]>([]);

  // Track form changes (must be after form declaration)
  useEffect(() => {
    if (activeTab === 'create') {
      const hasContent = form.contractNumber.trim() !== '' || form.contractName.trim() !== '' || form.products.length > 0;
      setFormDirty(hasContent);
    } else {
      setFormDirty(false);
    }
  }, [activeTab, form.contractNumber, form.contractName, form.products.length]);

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Bao_Gia_${form.clientName || 'Khach_Hang'}`,
  });

  useEffect(() => {
    productService.getProducts().then(setCatalogProducts).catch(console.error);
  }, []);

  const perms = user?.permissions || [];
  const canViewAll = perms.includes('view_all_reports') || perms.includes('director_feedback') || perms.includes('admin_panel');
  const isUserManager = !!(user?.role === 'Manager' || (user?.role && (user.role.startsWith('Trưởng') || user.role.includes('Trưởng'))));
  const canApproveContract = !!(canViewAll || perms.includes('approve_dept_reports') || isUserManager);
  const userDept = user?.department || '';
  const canEditContract = useCallback((c: Contract): boolean => {
    if (c.status === 'completed') return false;
    const isDeptManager = isUserManager && user?.department === c.department;
    return !!(c.createdBy === user?.id || isDeptManager || perms.includes('admin_panel') || perms.includes('director_feedback'));
  }, [isUserManager, user, perms]);

  const filtered = useMemo(() => {
    let list = contracts;

    if (activeTab === 'output' || activeTab === 'create') {
      list = list.filter(c => (c.contractType || 'output') === (activeTab === 'create' ? form.contractType : 'output') && c.status !== 'completed');
      if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    } else if (activeTab === 'input') {
      list = list.filter(c => c.contractType === 'input' && c.status !== 'completed');
      if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    } else if (activeTab === 'history') {
      list = list.filter(c => c.status === 'completed' && (c.contractType || 'output') === historyType);
      if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    } else if (activeTab === 'debts') {
      list = list.filter(c => (c.contractType || 'output') === debtType);
      
      if (filterDebt !== 'all') {
        list = list.filter(c => {
          const pTax = c.postTaxValue || 0;
          const paid = c.paidAmount || 0;
          const debt = Math.max(0, pTax - paid);
          if (filterDebt === 'unpaid') return paid === 0 && pTax > 0;
          if (filterDebt === 'partial') return paid > 0 && debt > 0;
          if (filterDebt === 'paid') return debt === 0 && pTax > 0;
          return true;
        });
      }
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.contractNumber.toLowerCase().includes(q) || c.clientName.toLowerCase().includes(q) || c.contractName.toLowerCase().includes(q) || (c.supplierName || '').toLowerCase().includes(q));
    }
    if (dateFrom) {
      list = list.filter(c => (c.createdAt || '') >= dateFrom);
    }
    if (dateTo) {
      list = list.filter(c => (c.createdAt || '') <= dateTo + 'T23:59:59');
    }
    return list;
  }, [contracts, search, filterStatus, filterDebt, debtType, historyType, activeTab, form.contractType, dateFrom, dateTo]);

  const totalPreTax = useMemo(() => filtered.reduce((s, c) => s + (c.preTaxValue || 0), 0), [filtered]);
  const totalPostTax = useMemo(() => filtered.reduce((s, c) => s + (c.postTaxValue || 0), 0), [filtered]);
  const totalPaid = useMemo(() => filtered.reduce((s, c) => s + (c.paidAmount || 0), 0), [filtered]);
  const totalDebt = Math.max(0, totalPostTax - totalPaid);
  const collectionRate = totalPostTax > 0 ? Math.round((totalPaid / totalPostTax) * 100) : 0;

  const expiringContracts = useMemo(() => {
    const today = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(today.getDate() + 30);

    return contracts.filter(c => {
      const tabType = activeTab === 'input' ? 'input' : 'output';
      if ((c.contractType || 'output') !== tabType) return false;
      if (c.status !== 'in_progress') return false;
      if (!c.endDate) return false;
      
      const endDate = new Date(c.endDate);
      if (isNaN(endDate.getTime())) return false;
      
      return endDate >= today && endDate <= thirtyDaysLater;
    });
  }, [contracts, activeTab]);

  const openCreate = (type?: ContractType) => {
    setEditingContract(null);
    const ct = type || (activeTab === 'input' ? 'input' : 'output');
    const newId = crypto.randomUUID ? crypto.randomUUID() : 'c-' + Math.random().toString(36).substring(2, 15);
    setForm({ id: newId, contractNumber: '', clientName: '', contractName: '', preTaxValue: 0, vatRate: 10, postTaxValue: 0, invoiceDate: '', invoiceNumber: '', products: [], status: 'draft', attachments: [], paidAmount: 0, projectId: '', contractType: ct, supplierName: '', documentChecklist: {}, linkedInputContractIds: [], signedDate: '', startDate: '', endDate: '', warrantyMonths: 0, payments: [], docSentDate: '', docReceivedDate: '', docAccountantDate: '', docReceiver: '', docAccountantUserId: '', docAccountantStatus: '', department: user?.department || '' });
    setNewProduct({ name: '', unit: '', quantity: '1', origin: '', unitPrice: '', vatRate: '8' });
    setEditingProductIdx(null);
    setReadOnlyContract(false);
    setActiveTab('create');
  };

  const openEdit = (c: Contract, readOnly = false) => {
    setEditingContract(c);
    setForm({ id: c.id, contractNumber: c.contractNumber, clientName: c.clientName, contractName: c.contractName, preTaxValue: c.preTaxValue, vatRate: c.vatRate || 10, postTaxValue: c.postTaxValue || 0, invoiceDate: c.invoiceDate || '', invoiceNumber: c.invoiceNumber || '', products: c.products || [], status: c.status || 'draft', attachments: c.attachments || [], paidAmount: c.paidAmount || 0, projectId: c.projectId || '', contractType: c.contractType || 'output', supplierName: c.supplierName || '', documentChecklist: c.documentChecklist || {}, linkedInputContractIds: [], signedDate: c.signedDate || '', startDate: c.startDate || '', endDate: c.endDate || '', warrantyMonths: c.warrantyMonths || 0, payments: c.payments || [], docSentDate: c.docSentDate || '', docReceivedDate: c.docReceivedDate || '', docAccountantDate: c.docAccountantDate || '', docReceiver: c.docReceiver || '', docAccountantUserId: c.docAccountantUserId || '', docAccountantStatus: c.docAccountantStatus || '', department: c.department || '' });
    setNewProduct({ name: '', unit: '', quantity: '1', origin: '', unitPrice: '', vatRate: '8' });
    setEditingProductIdx(null);
    setReadOnlyContract(readOnly);
    setActiveTab('create');
  };

  useEffect(() => {
    if (contractIdParam && contracts.length > 0) {
      const found = contracts.find(c => c.id === contractIdParam);
      if (found) {
        const readOnly = found.status === 'completed' || found.status === 'cancelled' || !canEditContract(found);
        openEdit(found, readOnly);
        setSearchParams({}, { replace: true });
      }
    }
  }, [contractIdParam, contracts, setSearchParams, canEditContract]);

  const openDuplicate = (c: Contract) => {
    setEditingContract(null);
    const newId = crypto.randomUUID ? crypto.randomUUID() : 'c-' + Math.random().toString(36).substring(2, 15);
    setForm({
      id: newId,
      contractNumber: '',
      clientName: c.clientName,
      contractName: c.contractName + ' (Bản sao)',
      preTaxValue: c.preTaxValue,
      vatRate: c.vatRate || 10,
      postTaxValue: c.postTaxValue || 0,
      invoiceDate: '',
      invoiceNumber: '',
      products: (c.products || []).map(p => ({ ...p, exportedQuantity: 0, invoicedQuantity: 0 })),
      status: 'draft',
      attachments: [],
      paidAmount: 0,
      projectId: c.projectId || '',
      contractType: c.contractType || 'output',
      supplierName: c.supplierName || '',
      documentChecklist: c.documentChecklist || {},
      linkedInputContractIds: [],
      signedDate: '',
      startDate: '',
      endDate: '',
      warrantyMonths: 0,
      payments: [],
      docSentDate: '',
      docReceivedDate: '',
      docAccountantDate: '',
      docReceiver: '',
      docAccountantUserId: '',
      docAccountantStatus: '',
      department: user?.department || ''
    });
    setNewProduct({ name: '', unit: '', quantity: '1', origin: '', unitPrice: '', vatRate: '8' });
    setEditingProductIdx(null);
    setReadOnlyContract(false);
    setActiveTab('create');
    showToast('info', 'Đã tạo bản sao. Vui lòng nhập Số hợp đồng mới.');
  };

  const handleEditProduct = (idx: number) => {
    const p = form.products[idx];
    setNewProduct({ name: p.name, unit: p.unit || '', quantity: String(p.quantity), origin: p.origin || '', unitPrice: Number(p.unitPrice).toLocaleString('vi-VN'), vatRate: String(p.vatRate ?? 8) });
    setEditingProductIdx(idx);
  };

  const handleAddProduct = () => {
    if (!newProduct.name || !newProduct.unitPrice) return;
    const unitPrice = Number(newProduct.unitPrice.replace(/\D/g, '')) || 0;

    if ((form.contractType || 'output') === 'output') {
      const dbProd = catalogProducts.find(p => p.name.trim().toLowerCase() === newProduct.name.trim().toLowerCase());
      if (dbProd) {
        const importPrice = Number(dbProd.importPrice) || 0;
        if (unitPrice <= importPrice) {
          showToast('error', `Đơn giá bán không được bằng hoặc thấp hơn giá mua (giá vốn: ${importPrice.toLocaleString('vi-VN')} ₫) trong kho!`);
          return;
        }
      }
    }

    const qty = Number(newProduct.quantity) || 1;
    const total = unitPrice * qty;
    const vatRate = Number(newProduct.vatRate) || 0;
    
    setForm(f => {
      const newList = [...f.products];
      if (editingProductIdx !== null) {
        const oldTotal = newList[editingProductIdx].total;
        newList[editingProductIdx] = { 
          ...newList[editingProductIdx], 
          name: newProduct.name, 
          unit: newProduct.unit, 
          quantity: qty, 
          origin: newProduct.origin, 
          unitPrice, 
          total, 
          vatRate,
          isBuyingPriceFallback: false 
        };
        const newPreTax = f.preTaxValue - oldTotal + total;
        const totalTax = newList.reduce((sum, p) => sum + (p.total * (p.vatRate ?? 8) / 100), 0);
        return { ...f, products: newList, preTaxValue: newPreTax, postTaxValue: newPreTax + totalTax };
      } else {
        const newPreTax = f.preTaxValue + total;
        const updatedList = [...newList, { name: newProduct.name, unit: newProduct.unit, quantity: qty, origin: newProduct.origin, unitPrice, total, vatRate }];
        const totalTax = updatedList.reduce((sum, p) => sum + (p.total * (p.vatRate ?? 8) / 100), 0);
        return { ...f, products: updatedList, preTaxValue: newPreTax, postTaxValue: newPreTax + totalTax };
      }
    });
    setNewProduct({ name: '', unit: '', quantity: '1', origin: '', unitPrice: '', vatRate: '8' });
    setEditingProductIdx(null);
  };

  const handleRemoveProduct = (idx: number) => {
    setForm(f => {
      const list = [...f.products];
      const p = list[idx];
      list.splice(idx, 1);
      const newPreTax = Math.max(0, f.preTaxValue - p.total);
      const totalTax = list.reduce((sum, p) => sum + (p.total * (p.vatRate ?? 8) / 100), 0);
      return { ...f, products: list, preTaxValue: newPreTax, postTaxValue: newPreTax + totalTax };
    });
  };

  const handleVatChange = (rate: number) => {
    // Only used if they change the contract-level vat (legacy support)
    setForm(f => ({ ...f, vatRate: rate, postTaxValue: f.preTaxValue + (f.preTaxValue * rate / 100) }));
  };

  const handlePreTaxChange = (val: number) => {
    setForm(f => {
      const totalTax = f.products.reduce((sum, p) => sum + (p.total * (p.vatRate ?? 8) / 100), 0);
      return { ...f, preTaxValue: val, postTaxValue: val + totalTax };
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const formData = new FormData();
    Array.from(e.target.files).forEach(f => formData.append('files', f));
    
    try {
      setUploading(true);
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const newUrls = data.files.map((f: any) => f.url);
      setForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), ...newUrls] }));
    } catch (err) {
      showToast('error', 'Lỗi khi tải file lên!');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removeAttachment = (idx: number) => {
    setForm(prev => {
      const list = [...(prev.attachments || [])];
      list.splice(idx, 1);
      return { ...prev, attachments: list };
    });
  };

  const handleSave = async () => {
    if (!form.contractNumber.trim()) {
      showToast('error', 'Vui lòng nhập Số hợp đồng!');
      return;
    }
    
    const isDuplicate = contracts.some(c => 
      c.contractNumber.trim().toLowerCase() === form.contractNumber.trim().toLowerCase() &&
      c.id !== editingContract?.id
    );

    if (isDuplicate) {
      showToast('error', 'Số hợp đồng này đã tồn tại trong hệ thống! Vui lòng kiểm tra lại.');
      return;
    }

    try {
      setSaving(true);
      const contract: Contract & { _isNew?: boolean; linkedInputContractIds?: string[] } = {
        _isNew: !editingContract,
        id: editingContract?.id || form.id || crypto.randomUUID(),
        contractNumber: form.contractNumber,
        clientName: form.clientName,
        contractName: form.contractName,
        products: form.products,
        preTaxValue: Number(form.preTaxValue) || 0,
        vatRate: Number(form.vatRate) || 0,
        postTaxValue: Number(form.postTaxValue) || 0,
        invoiceDate: form.invoiceDate || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        status: form.status,
        attachments: form.attachments,
        paidAmount: Number(form.paidAmount) || 0,
        department: editingContract?.department || form.department || user?.department || '',
        createdBy: user?.id || '',
        createdAt: editingContract?.createdAt || new Date().toISOString(),
        contractType: form.contractType || 'output',
        supplierName: form.supplierName || undefined,
        documentChecklist: {
          ...(form.documentChecklist || {}),
          hoaDon: form.invoiceNumber && form.invoiceNumber.trim() ? true : !!(form.documentChecklist && form.documentChecklist.hoaDon)
        },
        linkedInputContractIds: form.linkedInputContractIds || [],
        signedDate: form.signedDate || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        warrantyMonths: form.warrantyMonths !== undefined ? Number(form.warrantyMonths) : undefined,
        payments: form.payments || [],
        docSentDate: form.docSentDate || undefined,
        docReceivedDate: form.docReceivedDate || undefined,
        docAccountantDate: form.docAccountantDate || undefined,
        docReceiver: form.docReceiver || undefined,
        docAccountantUserId: form.docAccountantUserId || undefined,
        docAccountantStatus: form.docAccountantStatus || undefined,
      };
      await saveContract(contract);
      showToast('success', editingContract ? 'Đã cập nhật hợp đồng thành công!' : 'Đã tạo hợp đồng mới thành công!');
      setActiveTab(form.contractType === 'input' ? 'input' : 'output');
    } catch (err: any) {
      showToast('error', err.message || 'Lỗi khi lưu hợp đồng!');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteContract(deleteId);
        setDeleteId(null);
        showToast('success', 'Đã xóa hợp đồng thành công!');
      } catch (err: any) {
        showToast('error', err.message || 'Lỗi khi xóa hợp đồng!');
        setDeleteId(null);
      }
    }
  };

  const handleQuickStatusChange = async (c: Contract, newStatus: string) => {
    try {
      await saveContract({ ...c, status: newStatus, _isNew: false });
    } catch (e) {
      showToast('error', 'Lỗi khi cập nhật trạng thái!');
    }
  };

  const getUserName = (id: string) => users.find(u => u.id === id)?.name || id;

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      showToast('info', 'Không có dữ liệu để xuất!');
      return;
    }
    
    const dataToExport = filtered.map((c, i) => ({
      'STT': i + 1,
      'Số hợp đồng': c.contractNumber,
      'Chủ đầu tư': c.clientName,
      'Tên hợp đồng': c.contractName,
      'Trạng thái': { draft: 'Bản nháp', pending: 'Chờ duyệt', in_progress: 'Đang thực hiện', completed: 'Đã hoàn thành', cancelled: 'Đã hủy' }[c.status || 'draft'],
      'Giá trị trước thuế': c.preTaxValue,
      'Thuế VAT (%)': c.vatRate,
      'Tổng sau thuế': c.postTaxValue,
      'Đã thanh toán': c.paidAmount || 0,
      'Công nợ': Math.max(0, (c.postTaxValue || 0) - (c.paidAmount || 0)),
      'Ngày xuất HĐ': c.invoiceDate ? new Date(c.invoiceDate).toLocaleDateString('vi-VN') : '',
      'Số hóa đơn': c.invoiceNumber || ''
    }));

    void exportXlsx(dataToExport, `TranLe_Hop_Dong_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Hop_Dong');
  };

  const handleSaveExportStock = async (contractId: string, updatedProducts: ContractProduct[]) => {
    const targetContract = contracts.find(c => c.id === contractId);
    if (!targetContract) return;
    const newContract = { ...targetContract, products: updatedProducts };
    await saveContract(newContract);
  };

  const handleSaveExportInvoice = async (contractId: string, updatedProducts: ContractProduct[], invNumber: string, invDate: string) => {
    const targetContract = contracts.find(c => c.id === contractId);
    if (!targetContract) return;
    const currentChecklist = targetContract.documentChecklist || {};
    const newContract = { 
      ...targetContract, 
      products: updatedProducts, 
      invoiceNumber: invNumber, 
      invoiceDate: invDate,
      status: targetContract.status === 'draft' ? 'pending' : targetContract.status,
      documentChecklist: {
        ...currentChecklist,
        hoaDon: true
      }
    };
    await saveContract(newContract);
  };

  const handlePaymentSave = async (contractId: string, updatedPayments: any[], updatedPaidAmount: number) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    await saveContract({ ...contract, payments: updatedPayments, paidAmount: updatedPaidAmount, _isNew: false });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200">
              <FileText size={20} className="text-white"/>
            </div>
            Quản lý Hợp đồng
          </h1>
          <p className="text-sm text-gray-500 mt-1">Theo dõi và quản lý hợp đồng kinh doanh</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeTab !== 'create' && (
            <Button variant="secondary" onClick={handleExportExcel} size="sm" className="gap-1">
              <Download size={14}/> Xuất Excel
            </Button>
          )}
          {activeTab !== 'create' && activeTab !== 'links' && (
            <Button 
              variant={showCharts ? 'primary' : 'secondary'} 
              onClick={() => setShowCharts(!showCharts)} 
              size="sm" 
              className={`gap-1 ${showCharts ? '!from-indigo-500 !to-purple-600 hover:!from-indigo-600 hover:!to-purple-500 !shadow-indigo-500/30' : 'hover:text-indigo-600'}`}
            >
              {showCharts ? '📋 Ẩn biểu đồ' : '📊 Xem biểu đồ'}
            </Button>
          )}
          <Button variant={activeTab === 'output' ? 'primary' : 'secondary'} onClick={() => switchTab('output')} size="sm">📤 HĐ Bán</Button>
          <Button variant={activeTab === 'input' ? 'primary' : 'secondary'} onClick={() => switchTab('input')} size="sm">📥 HĐ Mua</Button>
          {(activeTab === 'output' || (activeTab === 'create' && form.contractType === 'output') || (activeTab !== 'input' && activeTab !== 'create')) && (
            <Button 
              variant={activeTab === 'create' && form.contractType === 'output' ? 'primary' : 'secondary'} 
              onClick={() => openCreate('output')} 
              size="sm" 
              className={`gap-1 ${activeTab === 'create' && form.contractType === 'output' ? '!from-emerald-500 !to-teal-600 hover:!from-emerald-600 hover:!to-teal-500 !shadow-emerald-500/30' : 'hover:text-emerald-600'}`}
            >
              <PlusCircle size={14}/> Thêm HĐ Bán
            </Button>
          )}
          {(activeTab === 'input' || (activeTab === 'create' && form.contractType === 'input') || (activeTab !== 'output' && activeTab !== 'create')) && (
            <Button 
              variant={activeTab === 'create' && form.contractType === 'input' ? 'primary' : 'secondary'} 
              onClick={() => openCreate('input')} 
              size="sm" 
              className={`gap-1 ${activeTab === 'create' && form.contractType === 'input' ? '!from-blue-500 !to-indigo-600 hover:!from-blue-600 hover:!to-indigo-500 !shadow-blue-500/30' : 'hover:text-blue-600'}`}
            >
              <PlusCircle size={14}/> Thêm HĐ Mua
            </Button>
          )}
        </div>
      </div>

      {/* Links Tab */}
      {activeTab === 'links' && (
        <ContractLinksTab contracts={contracts} />
      )}

      {activeTab !== 'create' && activeTab !== 'links' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <ContractMetrics 
            filtered={filtered}
            contracts={contracts}
            activeTab={activeTab}
            totalPreTax={totalPreTax}
            totalPostTax={totalPostTax}
            totalPaid={totalPaid}
            totalDebt={totalDebt}
            collectionRate={collectionRate}
            isInput={activeTab === 'input' || (activeTab === 'debts' && debtType === 'input') || (activeTab === 'history' && historyType === 'input')}
          />

          {showCharts && (
            <ContractCharts 
              contracts={filtered} 
              isInput={activeTab === 'input' || (activeTab === 'debts' && debtType === 'input') || (activeTab === 'history' && historyType === 'input')} 
            />
          )}

          {expiringContracts.length > 0 && (
            <div className="bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 rounded-2xl p-4 flex gap-3.5 shadow-sm shadow-amber-500/5 animate-in slide-in-from-top duration-300">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-amber-800">Hợp đồng sắp hết hạn thực hiện hoặc bảo hành (trong 30 ngày tới)</h4>
                <p className="text-xs text-amber-700/80 mt-0.5">Vui lòng kiểm tra và tiến hành nghiệm thu, thanh lý hoặc gia hạn nếu cần thiết.</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {expiringContracts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => openEdit(c, true)}
                      className="px-2.5 py-1 bg-white hover:bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-700 hover:text-amber-800 transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <FileText size={12} className="text-amber-500" />
                      <span>{c.contractNumber} - {c.clientName || c.supplierName} ({new Date(c.endDate!).toLocaleDateString('vi-VN')})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* List & Filters */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center gap-4 bg-gray-50/50">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Tìm theo số HĐ, tên khách hàng..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
                />
              </div>
              
              <div className="flex gap-2">
                {activeTab === 'debts' ? (
                  <>
                    <div className="flex bg-white border border-gray-200 p-0.5 rounded-xl shadow-sm">
                      <button 
                        onClick={() => setDebtType('output')} 
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${debtType === 'output' ? 'bg-emerald-50 text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        Phải thu (Bán)
                      </button>
                      <button 
                        onClick={() => setDebtType('input')} 
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${debtType === 'input' ? 'bg-rose-50 text-rose-600' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        Phải trả (Mua)
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Filter size={16} className="text-gray-400"/>
                      <select value={filterDebt} onChange={e => setFilterDebt(e.target.value)} className="bg-white border border-gray-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-gray-600">
                        <option value="all">Tất cả công nợ</option>
                        <option value="unpaid">Chưa thanh toán</option>
                        <option value="partial">Thanh toán một phần</option>
                        <option value="paid">Đã thanh toán đủ</option>
                      </select>
                    </div>
                  </>
                ) : activeTab === 'history' ? (
                  <div className="flex bg-white border border-gray-200 p-0.5 rounded-xl shadow-sm">
                    <button 
                      onClick={() => setHistoryType('output')} 
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${historyType === 'output' ? 'bg-emerald-50 text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      HĐ Bán đã hoàn thành
                    </button>
                    <button 
                      onClick={() => setHistoryType('input')} 
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${historyType === 'input' ? 'bg-rose-50 text-rose-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      HĐ Mua đã hoàn thành
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Filter size={16} className="text-gray-400"/>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-white border border-gray-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-gray-600">
                      <option value="all">Tất cả trạng thái</option>
                      <option value="draft">Bản nháp</option>
                      <option value="pending">Chờ duyệt</option>
                      <option value="in_progress">Đang thực hiện</option>
                      <option value="completed">Đã hoàn thành</option>
                      <option value="cancelled">Đã hủy</option>
                    </select>
                  </div>
                )}
                  <div className="flex items-center gap-2">
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} 
                      className="bg-white border border-gray-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-600"
                      title="Từ ngày"
                    />
                    <span className="text-gray-400 text-xs">-</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="bg-white border border-gray-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-600"
                      title="Đến ngày"
                    />
                    {(dateFrom || dateTo) && (
                      <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Xóa bộ lọc ngày">
                        <X size={14} />
                      </button>
                    )}
                  </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {activeTab === 'debts' ? (
                <ContractDebtTable 
                  filtered={filtered}
                  currentPage={currentPage}
                  itemsPerPage={itemsPerPage}
                  onPageChange={setCurrentPage}
                  totalPostTax={totalPostTax}
                  totalPaid={totalPaid}
                  totalDebt={totalDebt}
                  onPayment={(c) => setPaymentContract(c)}
                />
              ) : (
                <ContractTable 
                  filtered={filtered}
                  currentPage={currentPage}
                  itemsPerPage={itemsPerPage}
                  onPageChange={setCurrentPage}
                  canViewAll={canViewAll}
                  canApproveContract={canApproveContract}
                  canEditContract={canEditContract}
                  getUserName={getUserName}
                  onEdit={openEdit}
                  onDelete={(id) => setDeleteId(id)}
                  onQuickStatusChange={handleQuickStatusChange}
                  onExportStock={(c) => setExportStockContract(c)}
                  onExportInvoice={(c) => setExportInvoiceContract(c)}
                  onPayment={(c) => setPaymentContract(c)}
                  onDuplicate={openDuplicate}
                  currentUser={user}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'create' && (
        <ContractForm 
          form={form}
          setForm={setForm}
          editingContract={editingContract}
          tasks={tasks}
          contracts={contracts}
          clients={clients}
          projects={projects}
          catalogProducts={catalogProducts}
          canApproveContract={canApproveContract}
          newProduct={newProduct}
          setNewProduct={setNewProduct}
          editingProductIdx={editingProductIdx}
          setEditingProductIdx={setEditingProductIdx}
          uploading={uploading}
          handleFileUpload={handleFileUpload}
          removeAttachment={removeAttachment}
          handlePreTaxChange={handlePreTaxChange}
          handleVatChange={handleVatChange}
          handleEditProduct={handleEditProduct}
          handleRemoveProduct={handleRemoveProduct}
          handleAddProduct={handleAddProduct}
          handlePrint={handlePrint}
          handleSave={handleSave}
          setActiveTab={setActiveTab}
          readOnly={readOnlyContract}
          saving={saving}
          showToast={showToast}
          users={users}
          currentUser={user}
        />
      )}

      <ConfirmDialog isOpen={!!deleteId} title="Xóa hợp đồng" message="Bạn có chắc muốn xóa hợp đồng này?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} type="danger" confirmText="Xóa" cancelText="Hủy"/>

      <ConfirmDialog
        isOpen={!!pendingTab}
        title="Bạn có thay đổi chưa lưu"
        message="Nếu chuyển tab, dữ liệu chưa lưu sẽ bị mất. Bạn có muốn tiếp tục?"
        onConfirm={() => { setActiveTab(pendingTab as any); setPendingTab(null); setFormDirty(false); }}
        onCancel={() => setPendingTab(null)}
        type="warning"
        confirmText="Rời khỏi"
        cancelText="Ở lại"
      />

      <PaymentModal contract={paymentContract} onClose={() => setPaymentContract(null)} onSave={handlePaymentSave} />
      <ExportStockModal contract={exportStockContract} onClose={() => setExportStockContract(null)} onSave={handleSaveExportStock} />
      <ExportInvoiceModal contract={exportInvoiceContract} onClose={() => setExportInvoiceContract(null)} onSave={handleSaveExportInvoice} />

      <PrintableQuote ref={printRef} contract={form} user={user} />

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2" style={{ pointerEvents: 'none' }}>
          {toasts.map(toast => (
            <div
              key={toast.id}
              style={{ pointerEvents: 'auto' }}
              className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg font-medium text-sm text-white animate-in slide-in-from-bottom-4 duration-300 ${
                toast.type === 'success' ? 'bg-emerald-500 shadow-emerald-200' :
                toast.type === 'error' ? 'bg-red-500 shadow-red-200' :
                'bg-blue-500 shadow-blue-200'
              }`}
            >
              {toast.type === 'success' && <CheckCircle2 size={18} />}
              {toast.type === 'error' && <AlertCircle size={18} />}
              {toast.type === 'info' && <AlertCircle size={18} />}
              <span className="flex-1">{toast.message}</span>
              <button onClick={() => dismissToast(toast.id)} className="p-0.5 hover:bg-white/20 rounded transition-colors">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContractsPage;
