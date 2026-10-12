import React from 'react';
import { Printer, Pencil, Trash2, X, PlusCircle, Paperclip, FileText, Upload, Save, Package } from 'lucide-react';
import { Contract, ContractProduct, confirmContractReceipt, approveContract, rejectContract, cancelPendingContract } from '../../services/contractService';
import { canApproveContractValue } from '../../utils/rbac';
import { WarehousePickerModal } from './WarehousePickerModal';
import { Task, User } from '../../types';
import { CHECKLIST_ITEMS, numToVnText } from './contractUtils';
import { InputContractPickerModal } from './InputContractPickerModal';
import { InlineDocumentManager } from '../../components/InlineDocumentManager';
import { useData } from '../../contexts/DataContext';

interface ContractFormProps {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  editingContract: Contract | null;
  tasks: Task[];
  contracts: Contract[];
  clients: { name: string }[];
  projects: any[];
  catalogProducts: any[];
  canApproveContract: boolean;
  newProduct: any;
  setNewProduct: React.Dispatch<React.SetStateAction<any>>;
  editingProductIdx: number | null;
  setEditingProductIdx: React.Dispatch<React.SetStateAction<number | null>>;
  uploading: boolean;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeAttachment: (idx: number) => void;
  handlePreTaxChange: (val: number) => void;
  handleVatChange: (val: number) => void;
  handleEditProduct: (idx: number) => void;
  handleRemoveProduct: (idx: number) => void;
  handleAddProduct: () => void;
  handlePrint: () => void;
  handleSave: () => void;
  setActiveTab: (tab: any) => void;
  readOnly?: boolean;
  saving?: boolean;
  showToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  users?: User[];
  currentUser?: User | null;
}

export const ContractForm: React.FC<ContractFormProps> = ({
  form, setForm, editingContract, tasks, contracts, clients, projects, catalogProducts,
  canApproveContract, newProduct, setNewProduct, editingProductIdx, setEditingProductIdx,
  uploading, handleFileUpload, removeAttachment,
  handlePreTaxChange, handleVatChange, handleEditProduct, handleRemoveProduct, handleAddProduct,
  handlePrint, handleSave, setActiveTab, readOnly, saving, showToast, users, currentUser
}) => {
  const [showWarehousePicker, setShowWarehousePicker] = React.useState(false);
  const [showInputPicker, setShowInputPicker] = React.useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = React.useState(false);
  const { refreshData } = useData();

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

  // Contract Approval states
  const [showRejectReason, setShowRejectReason] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');
  const [actionLoading, setActionLoading] = React.useState(false);

  const isFormLocked = React.useMemo(() => {
    return readOnly || form.docAccountantStatus === 'confirmed';
  }, [readOnly, form.docAccountantStatus]);

  React.useEffect(() => {
    if (form.invoiceNumber && form.invoiceNumber.trim()) {
      if (!form.documentChecklist?.hoaDon) {
        setForm((f: any) => ({
          ...f,
          documentChecklist: {
            ...(f.documentChecklist || {}),
            hoaDon: true
          }
        }));
      }
    } else {
      if (form.documentChecklist?.hoaDon) {
        setForm((f: any) => ({
          ...f,
          documentChecklist: {
            ...(f.documentChecklist || {}),
            hoaDon: false
          }
        }));
      }
    }
  }, [form.invoiceNumber, setForm]);

  const isInput = form.contractType === 'input';
  const ringColor = isInput ? 'focus:ring-blue-500' : 'focus:ring-emerald-500';
  const borderColor = isInput ? 'border-blue-200' : 'border-emerald-200';
  const btnColor = isInput ? 'bg-blue-500 hover:bg-blue-600' : 'bg-emerald-500 hover:bg-emerald-600';
  const textColor = isInput ? 'text-blue-600' : 'text-emerald-600';

  const canApproveThisContract = React.useMemo(() => {
    if (!currentUser) return false;
    const perms = currentUser.permissions || [];
    const userRole = currentUser.role || '';
    const isSystemAdmin = perms.includes('admin_panel') || perms.includes('director_feedback') || userRole === 'Admin' || userRole === 'Director' || userRole === 'Giám đốc';
    const isDeptManager = (userRole === 'Manager' || userRole.startsWith('Trưởng') || userRole.includes('Trưởng')) && currentUser.department === form.department;
    // Nút gọi endpoint approve (có hạn mức TP <500M / P.GĐ <2B ở backend).
    if (!isSystemAdmin && !isDeptManager) {
      const level = currentUser.managementLevel ?? 10;
      const sameDept = !!currentUser.department && !!form.department && currentUser.department === form.department;
      if (!(level >= 30 && sameDept)) return false;
    }
    return canApproveContractValue(currentUser, { department: form.department, preTaxValue: form.preTaxValue, postTaxValue: form.postTaxValue });
  }, [currentUser, form.department, form.preTaxValue, form.postTaxValue]);

  const isChecklistComplete = React.useMemo(() => {
    return CHECKLIST_ITEMS.every(item => form.documentChecklist?.[item.key]);
  }, [form.documentChecklist]);

  const steps = React.useMemo(() => [
    { key: 'draft', label: 'Bản nháp', desc: 'Đang soạn thảo' },
    { key: 'pending', label: 'Chờ duyệt', desc: 'Đợi phê duyệt' },
    { key: 'in_progress', label: 'Đang thực hiện', desc: 'Đang triển khai' },
    { key: 'completed', label: 'Hoàn thành', desc: 'Đã nghiệm thu' },
  ], []);

  const currentStepIdx = React.useMemo(() => {
    const status = form.status || 'draft';
    if (status === 'draft') return 0;
    if (status === 'pending') return 1;
    if (status === 'in_progress') return 2;
    if (status === 'completed') return 3;
    return -1;
  }, [form.status]);

  const isHandoverDisabled = isFormLocked || !isChecklistComplete;

  const [showCancelReason, setShowCancelReason] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const handleCancelPending = async () => {
    if (!form.id) return;
    if (!cancelReason.trim()) {
      if (showToast) showToast('error', 'Vui lòng nhập lý do hủy hợp đồng');
      return;
    }
    try {
      setActionLoading(true);
      const res = await cancelPendingContract(form.id, cancelReason.trim());
      if (res.success) {
        setForm((f: any) => ({
          ...f,
          status: 'cancelled',
          approvalFeedback: cancelReason.trim()
        }));
        setShowCancelReason(false);
        setCancelReason('');
        if (showToast) showToast('success', 'Đã hủy hợp đồng thành công!');
      }
    } catch (err: any) {
      if (showToast) showToast('error', err.message || 'Lỗi khi hủy hợp đồng');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!form.id) return;
    try {
      setActionLoading(true);
      const res = await approveContract(form.id);
      if (res.success) {
        setForm((f: any) => ({
          ...f,
          status: 'in_progress',
          approvalFeedback: null
        }));
        if (showToast) showToast('success', 'Phê duyệt hợp đồng thành công!');
      }
    } catch (err: any) {
      if (showToast) showToast('error', err.message || 'Lỗi khi phê duyệt hợp đồng');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!form.id) return;
    if (!rejectReason.trim()) {
      if (showToast) showToast('error', 'Vui lòng nhập lý do từ chối');
      return;
    }
    try {
      setActionLoading(true);
      const res = await rejectContract(form.id, rejectReason.trim());
      if (res.success) {
        setForm((f: any) => ({
          ...f,
          status: 'draft',
          approvalFeedback: rejectReason.trim()
        }));
        setShowRejectReason(false);
        setRejectReason('');
        if (showToast) showToast('success', 'Đã từ chối duyệt hợp đồng và chuyển về Bản nháp!');
      }
    } catch (err: any) {
      if (showToast) showToast('error', err.message || 'Lỗi khi từ chối phê duyệt');
    } finally {
      setActionLoading(false);
    }
  };

  const accountantUsers = React.useMemo(() => {
    if (!users) return [];
    const filtered = users.filter(u => {
      const dept = (u.department || '').toLowerCase();
      const role = (u.role || '').toLowerCase();
      return dept.includes('finance') || dept.includes('kế toán') || dept.includes('ke toan') || role.includes('accountant') || role.includes('kế toán');
    });
    return filtered.length > 0 ? filtered : users;
  }, [users]);

  const handleConfirmReceipt = async () => {
    if (!form.id) return;
    try {
      setConfirmingReceipt(true);
      const res = await confirmContractReceipt(form.id);
      if (res.success) {
        setForm((f: any) => ({
          ...f,
          docAccountantStatus: 'confirmed',
          docAccountantDate: res.docAccountantDate,
          status: 'completed'
        }));
        await refreshData();
        if (showToast) showToast('success', 'Đã xác nhận nhận hồ sơ & hoàn thành hợp đồng!');
        setActiveTab('history');
      }
    } catch (err: any) {
      if (showToast) showToast('error', err.message || 'Lỗi khi xác nhận nhận hồ sơ');
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const handleSelectFromInputContract = (products: ContractProduct[], contractId: string) => {
    const srcContract = contracts.find(c => c.id === contractId);
    const contractNumberTrimmed = srcContract?.contractNumber?.trim() || '';

    let triggeredFallback = false;
    const newProducts = products.map((p, idx) => {
      const expectedImportCode = `${contractNumberTrimmed}-${idx + 1}`;
      let dbProd = catalogProducts.find(cp => cp.importCode === expectedImportCode);
      if (!dbProd) {
        dbProd = catalogProducts.find(cp => cp.name.trim().toLowerCase() === p.name.trim().toLowerCase());
      }
      const hasSalePrice = dbProd && dbProd.salePrice && Number(dbProd.salePrice) > 0;

      const suggestedPrice = hasSalePrice ? Number(dbProd.salePrice) : Number(p.unitPrice);
      const isFallback = !hasSalePrice;

      if (isFallback) {
        triggeredFallback = true;
      }

      return {
        name: p.name,
        unit: p.unit || '',
        origin: p.origin || '',
        quantity: p.quantity || 1,
        unitPrice: suggestedPrice,
        total: (p.quantity || 1) * suggestedPrice,
        exportedQuantity: p.quantity || 1,
        isBuyingPriceFallback: isFallback,
        sourceProductId: dbProd?.id || '',
        sourceProductName: dbProd?.name || '',
        importCode: dbProd?.importCode || expectedImportCode
      };
    });

    if (triggeredFallback && showToast) {
      showToast('error', '⚠️ Phát hiện sản phẩm chưa có giá bán gợi ý! Đã đề xuất tạm thời bằng giá mua. Bạn cần thay đổi giá bán!');
    }

    setForm((f: any) => {
      const currentLinked = f.linkedInputContractIds || [];
      const newLinked = currentLinked.includes(contractId) ? currentLinked : [...currentLinked, contractId];
      return {
        ...f,
        products: [...f.products, ...newProducts],
        linkedInputContractIds: newLinked
      };
    });

    // Auto update totals
    const preTax = [...form.products, ...newProducts].reduce((sum: number, item: any) => sum + (item.total || 0), 0);
    handlePreTaxChange(preTax);
  };

  const handleSelectFromWarehouse = (selectedItems: { product: any; quantity: number }[]) => {
    const newProducts = selectedItems.map(item => {
      // Find output contracts that have this product (excluding cancelled)
      const match = contracts
        .filter(c => (c.contractType || 'output') === 'output' && c.status !== 'cancelled')
        .flatMap(c => c.products || [])
        .find(cp => cp.name.trim().toLowerCase() === item.product.name.trim().toLowerCase());
      const salePrice = match ? match.unitPrice : (item.product.salePrice || item.product.defaultPrice || 0);

      return {
        name: item.product.name,
        unit: item.product.unit || '',
        origin: item.product.origin || '',
        quantity: item.quantity,
        unitPrice: salePrice,
        total: item.quantity * salePrice,
        exportedQuantity: item.quantity,
        sourceProductId: item.product.id,
        sourceProductName: item.product.name,
        importCode: item.product.importCode
      };
    });

    setForm((f: any) => ({
      ...f,
      products: [...f.products, ...newProducts],
      preTaxValue: f.preTaxValue + newProducts.reduce((sum, p) => sum + p.total, 0)
    }));
  };

  return (
    <div className="print-area bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden animate-in fade-in duration-300">
      <div className={`flex items-center justify-between px-6 py-4 text-white bg-gradient-to-r ${
        form.contractType === 'input' 
          ? 'from-blue-500 to-indigo-600' 
          : 'from-emerald-500 to-teal-600'
      }`}>
        <h2 className="text-lg font-bold">
          {isFormLocked 
            ? (form.contractType === 'input' ? 'Chi tiết Hợp đồng Mua' : 'Chi tiết Hợp đồng Bán') 
            : editingContract 
              ? (form.contractType === 'input' ? 'Sửa Hợp đồng Mua' : 'Sửa Hợp đồng Bán') 
              : (form.contractType === 'input' ? 'Thêm hợp đồng Mua mới' : 'Thêm hợp đồng Bán mới')}
        </h2>
        <div className="flex gap-2">
          {form.contractType === 'output' && (
            <button onClick={() => handlePrint()} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium transition-colors text-sm">
              <Printer size={16} /> In báo giá
            </button>
          )}
        </div>
      </div>

      {/* 4-Step Horizontal Progress Pipeline */}
      {form.status !== 'cancelled' && (
        <div className="bg-slate-50/50 border-b border-gray-100 px-6 py-5">
          <div className="max-w-3xl mx-auto flex items-center justify-between relative">
            {/* Background Line */}
            <div className="absolute left-[3%] right-[3%] top-1/2 -translate-y-1/2 h-1 bg-gray-200 rounded-full z-0">
              <div 
                className={`h-full rounded-full transition-all duration-500 z-0 bg-gradient-to-r ${
                  form.contractType === 'input' 
                    ? 'from-blue-500 to-indigo-600' 
                    : 'from-emerald-500 to-teal-600'
                }`}
                style={{ width: `${(currentStepIdx / 3) * 100}%` }}
              />
            </div>

            {/* Steps */}
            {steps.map((step, idx) => {
              const isActive = idx <= currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              
              // Colors
              let bgClass = 'bg-gray-200 border-gray-300 text-gray-400';
              let textClass = 'text-gray-500 font-medium';
              
              if (isActive) {
                if (form.contractType === 'input') {
                  bgClass = isCurrent 
                    ? 'bg-indigo-600 border-indigo-200 text-white ring-4 ring-indigo-100 shadow-md shadow-indigo-600/20' 
                    : 'bg-indigo-500 border-indigo-300 text-white';
                  textClass = isCurrent ? 'text-indigo-600 font-extrabold' : 'text-indigo-500 font-bold';
                } else {
                  bgClass = isCurrent 
                    ? 'bg-emerald-600 border-emerald-200 text-white ring-4 ring-emerald-100 shadow-md shadow-emerald-600/20' 
                    : 'bg-emerald-500 border-emerald-300 text-white';
                  textClass = isCurrent ? 'text-emerald-600 font-extrabold' : 'text-emerald-500 font-bold';
                }
              }

              return (
                <div key={step.key} className="flex flex-col items-center relative z-10 w-1/4">
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs transition-all duration-300 font-bold ${bgClass}`}>
                    {idx + 1}
                  </div>
                  <span className={`text-[11px] mt-2 text-center transition-all ${textClass}`}>
                    {step.label}
                  </span>
                  <span className="text-[9px] text-gray-400 font-bold mt-0.5 text-center hidden sm:block">
                    {step.desc}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {form.status === 'cancelled' && (
        <div className="bg-rose-50/60 border-b border-rose-100 px-6 py-3 flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping"></span>
          <span className="text-xs font-bold text-rose-700 uppercase tracking-widest">Hợp đồng này đã bị hủy bỏ</span>
        </div>
      )}

      {/* Warning banner: Pending approval for employee */}
      {form.status === 'pending' && !canApproveThisContract && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex items-center gap-3 animate-in slide-in-from-top duration-300">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold animate-pulse">⏳</span>
          <div>
            <h4 className="text-sm font-bold text-amber-800">Đang chờ phê duyệt</h4>
            <p className="text-xs text-amber-600">Hợp đồng này đang chờ Trưởng phòng phê duyệt. Bạn vẫn có thể chỉnh sửa và cập nhật thông tin nếu cần thiết.</p>
          </div>
        </div>
      )}

      {/* Warning banner: Rejected with feedback */}
      {form.status === 'draft' && form.approvalFeedback && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-4 flex items-start gap-3 animate-in slide-in-from-top duration-300">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold">❌</span>
          <div className="flex-1">
            <h4 className="text-sm font-bold text-rose-800">Yêu cầu sửa đổi - Bị từ chối duyệt</h4>
            <p className="text-xs text-rose-700 mt-0.5">Lý do từ chối: <span className="font-bold">{form.approvalFeedback}</span></p>
            <p className="text-xs text-rose-500 mt-1">Vui lòng kiểm tra lại các điều khoản, chỉnh sửa thông tin cần thiết và gửi lại yêu cầu phê duyệt.</p>
          </div>
        </div>
      )}

      {/* Manager Approval Card */}
      {form.status === 'pending' && canApproveThisContract && (
        <div className="bg-gradient-to-r from-slate-50 to-emerald-50/30 border-b border-emerald-100 px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in slide-in-from-top duration-300">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 text-lg font-bold">📋</span>
            <div>
              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Yêu cầu xét duyệt Hợp đồng</h4>
              <p className="text-xs text-slate-500 mt-0.5">Số HĐ: <span className="font-bold text-emerald-600">{form.contractNumber || '--'}</span> | Khách hàng: <span className="font-bold text-slate-700">{form.clientName || '--'}</span></p>
              <p className="text-xs text-slate-500">Người tạo: <span className="font-semibold text-slate-700">{users?.find(u => u.id === form.createdBy)?.name || 'Nhân viên'}</span> | Giá trị sau thuế: <span className="font-bold text-teal-600">{(form.postTaxValue || 0).toLocaleString('vi-VN')} ₫</span></p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 min-w-[320px]">
            {showRejectReason ? (
              <div className="flex flex-col gap-2 w-full">
                <input 
                  type="text" 
                  placeholder="Nhập lý do từ chối..." 
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  className="px-3 py-2 text-sm border border-rose-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <button 
                    disabled={actionLoading}
                    onClick={() => setShowRejectReason(false)}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    disabled={actionLoading || !rejectReason.trim()}
                    onClick={() => handleReject()}
                    className="px-3 py-1 text-xs bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Đang gửi...' : 'Xác nhận từ chối'}
                  </button>
                </div>
              </div>
            ) : showCancelReason ? (
              <div className="flex flex-col gap-2 w-full">
                <input 
                  type="text" 
                  placeholder="Nhập lý do hủy hợp đồng..." 
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  className="px-3 py-2 text-sm border border-rose-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <button 
                    disabled={actionLoading}
                    onClick={() => setShowCancelReason(false)}
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors"
                  >
                    Quay lại
                  </button>
                  <button 
                    disabled={actionLoading || !cancelReason.trim()}
                    onClick={() => handleCancelPending()}
                    className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Đang gửi...' : 'Xác nhận hủy HĐ'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 w-full flex-wrap sm:flex-nowrap">
                <button
                  disabled={actionLoading}
                  onClick={() => setShowCancelReason(true)}
                  className="flex-1 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl border border-red-200 transition-all flex items-center justify-center gap-1.5 text-sm shadow-sm"
                >
                  Hủy hợp đồng
                </button>
                <button
                  disabled={actionLoading}
                  onClick={() => setShowRejectReason(true)}
                  className="flex-1 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl border border-rose-200 transition-all flex items-center justify-center gap-1.5 text-sm shadow-sm"
                >
                  Từ chối duyệt
                </button>
                <button
                  disabled={actionLoading}
                  onClick={() => handleApprove()}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl transition-all flex items-center justify-center gap-1.5 text-sm shadow-md hover:shadow-emerald-200"
                >
                  {actionLoading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    'Phê duyệt'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <fieldset disabled={isFormLocked} className="group-disabled">
        <div className="p-6 space-y-5">
          {editingContract && tasks && (
          <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 mb-6">
            <div className="flex justify-between items-end mb-2">
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
                Tiến độ thực hiện ({tasks.filter(t => t.contractId === editingContract.id && t.status === 'Done').length}/{tasks.filter(t => t.contractId === editingContract.id).length} Task)
              </h3>
              <span className="text-lg font-black text-emerald-600">
                {tasks.filter(t => t.contractId === editingContract.id).length > 0 ? Math.round((tasks.filter(t => t.contractId === editingContract.id && t.status === 'Done').length / tasks.filter(t => t.contractId === editingContract.id).length) * 100) : 0}%
              </span>
            </div>
            <div className="w-full bg-emerald-100 rounded-full h-2.5 overflow-hidden">
              <div className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${tasks.filter(t => t.contractId === editingContract.id).length > 0 ? Math.round((tasks.filter(t => t.contractId === editingContract.id && t.status === 'Done').length / tasks.filter(t => t.contractId === editingContract.id).length) * 100) : 0}%` }}></div>
            </div>
            {tasks.filter(t => t.contractId === editingContract.id).length > 0 && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tasks.filter(t => t.contractId === editingContract.id).map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-sm bg-white px-3 py-2 rounded-lg border border-emerald-50 shadow-sm">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.status === 'Done' ? 'bg-emerald-500' : t.status === 'In Progress' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`}></div>
                    <span className={`truncate flex-1 font-medium ${t.status === 'Done' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{t.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!editingContract && (
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 border-dashed mb-6 text-center">
            <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
            <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-1">Tiến độ công việc</h3>
            <p className="text-xs text-gray-500">Vui lòng <span className="font-bold text-emerald-600">Lưu hợp đồng</span> lần đầu để có thể theo dõi và gán công việc.</p>
          </div>
        )}
        


        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Số hợp đồng *</label>
            <input 
              list="contract-number-suggestions"
              value={form.contractNumber} 
              onChange={e => setForm((f: any) => ({...f, contractNumber: e.target.value}))} 
              placeholder="VD: HD 02-2026/TL-SOLAR"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50"
            />
            <datalist id="contract-number-suggestions">
              {Array.from(new Set(contracts.map(c => c.contractNumber?.trim()).filter(Boolean))).sort().map(num => (
                <option key={num} value={num} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">{form.contractType === 'input' ? 'Nhà cung cấp *' : 'Khách hàng / Chủ đầu tư *'}</label>
            <input 
              list="client-suggestions"
              value={form.contractType === 'input' ? form.supplierName : form.clientName} 
              onChange={e => form.contractType === 'input' ? setForm((f: any) => ({...f, supplierName: e.target.value, clientName: e.target.value})) : setForm((f: any) => ({...f, clientName: e.target.value}))} 
              placeholder={form.contractType === 'input' ? 'VD: Công ty TNHH AIKO Solar' : 'VD: Công ty TNHH Cocotex'}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50"
            />
            <datalist id="client-suggestions">
              {Array.from(new Set([
                ...clients.map(c => c.name),
                ...contracts.map(c => c.clientName?.trim()),
                ...contracts.filter(c => c.supplierName).map(c => c.supplierName!.trim())
              ].filter(Boolean))).sort().map(client => (
                <option key={client} value={client} />
              ))}
            </datalist>
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Tên hợp đồng / Mô tả chung *</label>
            <input 
              list="contract-name-suggestions"
              value={form.contractName} 
              onChange={e => setForm((f: any) => ({...f, contractName: e.target.value}))} 
              placeholder="VD: Cung cấp và lắp đặt hệ thống điện mặt trời 100kWp"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50"
            />
            <datalist id="contract-name-suggestions">
              {Array.from(new Set(contracts.map(c => c.contractName?.trim()).filter(Boolean))).sort().map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Thuộc Dự án (Tùy chọn)</label>
            <select value={form.projectId || ''} onChange={e => setForm((f: any) => ({...f, projectId: e.target.value}))}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
              <option value="">-- Không thuộc dự án nào --</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} - {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Trạng thái *</label>
            <select value={form.status} onChange={e => setForm((f: any) => ({...f, status: e.target.value}))}
              className="w-full px-4 py-2.5 text-sm font-bold text-gray-700 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
              <option value="draft">Bản nháp</option>
              <option value="pending">Chờ duyệt</option>
              {(canApproveThisContract || form.status === 'in_progress') && <option value="in_progress">Đang thực hiện</option>}
              {(canApproveThisContract || form.status === 'completed') && <option value="completed">Đã hoàn thành</option>}
              {(canApproveThisContract || form.status === 'cancelled') && <option value="cancelled">Đã hủy</option>}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Ngày ký HĐ</label>
            <input 
              type="date"
              value={form.signedDate || ''} 
              onChange={e => setForm((f: any) => ({...f, signedDate: e.target.value}))} 
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 text-gray-700"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Ngày bắt đầu hiệu lực</label>
            <input 
              type="date"
              value={form.startDate || ''} 
              onChange={e => setForm((f: any) => ({...f, startDate: e.target.value}))} 
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 text-gray-700"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Ngày kết thúc</label>
            <input 
              type="date"
              value={form.endDate || ''} 
              onChange={e => setForm((f: any) => ({...f, endDate: e.target.value}))} 
              className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 text-gray-700"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Thời hạn bảo hành</label>
            <div className="relative">
              <input 
                type="number"
                min="0"
                value={form.warrantyMonths ?? ''} 
                onChange={e => {
                  const val = e.target.value;
                  setForm((f: any) => ({...f, warrantyMonths: val === '' ? undefined : Number(val)}));
                }} 
                placeholder="VD: 12"
                className="w-full pl-4 pr-12 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 text-gray-700 font-bold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-bold">tháng</span>
            </div>
          </div>
        </div>

        {form.contractType === 'input' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-4 bg-blue-50/40 border border-blue-100 rounded-2xl mb-2">
            <div>
              <label className="block text-xs font-bold text-blue-700 mb-1 uppercase tracking-wider">Số hóa đơn mua (Tùy chọn)</label>
              <input 
                value={form.invoiceNumber || ''} 
                onChange={e => setForm((f: any) => ({...f, invoiceNumber: e.target.value}))} 
                placeholder="VD: 0001234"
                className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium text-gray-700"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-blue-700 mb-1 uppercase tracking-wider">Ngày hóa đơn mua (Tùy chọn)</label>
              <input 
                type="date"
                value={form.invoiceDate || ''} 
                onChange={e => setForm((f: any) => ({...f, invoiceDate: e.target.value}))} 
                className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium text-gray-700"
              />
            </div>
          </div>
        )}

        {/* Chi tiết sản phẩm */}
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider">Chi tiết sản phẩm / Dịch vụ</label>
            {form.contractType === 'output' && !isFormLocked && (
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowInputPicker(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg text-xs font-bold transition-colors border border-blue-200"
                >
                  <FileText size={14} /> Chọn từ HĐ Mua vào
                </button>
                <button 
                  onClick={() => setShowWarehousePicker(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg text-xs font-bold transition-colors border border-emerald-200"
                >
                  <Package size={14} /> Chọn từ kho
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto mb-4 border border-gray-200 rounded-lg">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-[11px] uppercase tracking-wider">
                  <th className="p-3 font-bold border-b border-gray-200 text-center w-12">STT</th>
                  <th className="p-3 font-bold border-b border-gray-200 min-w-[200px]">Tên sản phẩm *</th>
                  <th className="p-3 font-bold border-b border-gray-200 w-24">ĐVT</th>
                  <th className="p-3 font-bold border-b border-gray-200 w-32">Xuất xứ</th>
                  <th className="p-3 font-bold border-b border-gray-200 w-20 text-center">SL *</th>
                  <th className="p-3 font-bold border-b border-gray-200 w-36 text-right">Đơn giá (VNĐ) *</th>
                  <th className="p-3 font-bold border-b border-gray-200 w-20 text-center">Thuế (%)</th>
                  <th className="p-3 font-bold border-b border-gray-200 w-36 text-right">Thành tiền (VNĐ)</th>
                  {!isFormLocked && <th className="p-3 font-bold border-b border-gray-200 w-24 text-center">Thao tác</th>}
                </tr>
              </thead>
              <tbody className="bg-white">
                {form.products.map((p: ContractProduct, idx: number) => {
                  const isEditing = !isFormLocked && editingProductIdx === idx;
                  const activeBg = isInput ? 'bg-blue-50/40 border-blue-200' : 'bg-emerald-50/40 border-emerald-200';

                  if (isEditing) {
                    return (
                      <tr key={idx} className={`border-b transition-colors ${activeBg}`}>
                        <td className="p-3 text-sm font-bold text-center align-middle" style={{ color: isInput ? '#2563eb' : '#059669' }}>
                          {idx + 1}
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            value={newProduct.name} 
                            onChange={e => {
                              const val = e.target.value;
                              const updates: any = { name: val };
                              if (val) {
                                const catalogMatch = catalogProducts.find(prod => prod.name.trim().toLowerCase() === val.trim().toLowerCase());
                                const historyMatch = contracts.flatMap(c => c.products || []).find(prod => prod.name?.trim().toLowerCase() === val.trim().toLowerCase());
                                const match = catalogMatch || historyMatch;
                                if (match) {
                                  if (!newProduct.unit) updates.unit = match.unit || '';
                                  if (!newProduct.origin) updates.origin = match.origin || '';
                                  if (!newProduct.unitPrice) {
                                    let priceVal = '';
                                    if ('importPrice' in match || 'salePrice' in match) {
                                      if (form.contractType === 'input' && match.importPrice) priceVal = String(match.importPrice);
                                      else if (form.contractType !== 'input' && match.salePrice) priceVal = String(match.salePrice);
                                      else if (match.defaultPrice !== undefined) priceVal = String(match.defaultPrice);
                                    } else if ('unitPrice' in match) {
                                      priceVal = String(match.unitPrice);
                                    }
                                    if (priceVal) {
                                      updates.unitPrice = Number(priceVal.replace(/\D/g, '')).toLocaleString('vi-VN');
                                    }
                                  }
                                }
                              }
                              setNewProduct({...newProduct, ...updates});
                            }} 
                            placeholder="Nhập tên SP..."
                            list="product-name-suggestions"
                            className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white font-bold ${borderColor} ${ringColor}`}
                          />
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            value={newProduct.unit} 
                            onChange={e => setNewProduct({...newProduct, unit: e.target.value})} 
                            placeholder="VD: Cái"
                            list="product-unit-suggestions"
                            className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white ${borderColor} ${ringColor}`}
                          />
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            value={newProduct.origin} 
                            onChange={e => setNewProduct({...newProduct, origin: e.target.value})} 
                            placeholder="VD: VN"
                            list="product-origin-suggestions"
                            className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white ${borderColor} ${ringColor}`}
                          />
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            type="number" 
                            min="1" 
                            value={newProduct.quantity} 
                            onChange={e => setNewProduct({...newProduct, quantity: e.target.value})} 
                            placeholder="1"
                            className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white text-center font-semibold ${borderColor} ${ringColor}`}
                          />
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            type="text" 
                            value={newProduct.unitPrice || ''} 
                            onChange={e => handleNumericInputChange(e, val => setNewProduct({...newProduct, unitPrice: val}))} 
                            placeholder="1.000.000"
                            list="product-price-suggestions"
                            className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white text-right font-bold ${borderColor} ${ringColor}`}
                          />
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            type="number" 
                            min="0" 
                            max="100" 
                            value={newProduct.vatRate} 
                            onChange={e => setNewProduct({...newProduct, vatRate: e.target.value})} 
                            placeholder="8"
                            className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white text-center font-medium ${borderColor} ${ringColor}`}
                          />
                        </td>
                        <td className="p-2 align-middle">
                          <input 
                            type="text" 
                            readOnly 
                            disabled
                            value={((Number(newProduct.quantity) || 1) * (Number(newProduct.unitPrice.replace(/\D/g, '')) || 0)).toLocaleString('vi-VN')}
                            className={`w-full px-2 py-1.5 text-sm border border-transparent rounded-md font-extrabold text-right cursor-not-allowed ${
                              isInput ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          />
                        </td>
                        <td className="p-2 text-center align-middle">
                          <div className="flex gap-1 justify-center">
                            <button 
                              onClick={handleAddProduct} 
                              disabled={!newProduct.name || !newProduct.unitPrice}
                              className={`px-3 py-1.5 text-xs font-bold text-white rounded-md disabled:opacity-50 transition-colors flex items-center justify-center shadow-sm ${btnColor}`} 
                              title="Lưu"
                            >
                              Lưu
                            </button>
                            <button 
                              onClick={() => { 
                                setNewProduct({ name: '', unit: '', quantity: '1', origin: '', unitPrice: '', vatRate: '8' }); 
                                setEditingProductIdx(null); 
                              }}
                              className="p-1.5 text-xs font-bold text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors flex items-center justify-center shadow-sm" 
                              title="Hủy"
                            >
                              <X size={14}/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={idx} className={`border-b border-gray-100 transition-colors ${
                      p.isBuyingPriceFallback 
                        ? 'bg-amber-50/70 hover:bg-amber-100/80 dark:bg-amber-950/20 border-amber-100' 
                        : 'hover:bg-gray-50'
                    }`}>
                      <td className="p-3 text-sm text-gray-500 font-medium text-center">{idx + 1}</td>
                      <td className="p-3 text-sm font-bold text-gray-800">
                        <div>{p.name}</div>
                        {p.isBuyingPriceFallback && (
                          <div className="mt-1 text-[10px] font-bold text-amber-600 animate-pulse">
                            ⚠️ Giá đề xuất từ HĐ Mua (Chưa có giá bán gợi ý)
                          </div>
                        )}
                        {p.sourceProductId && (
                          <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                            <Package size={10} /> Kho
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-sm text-gray-600">{p.unit || '-'}</td>
                      <td className="p-3 text-sm text-gray-600">{p.origin || '-'}</td>
                      <td className="p-3 text-sm font-semibold text-gray-700 text-center">{p.quantity}</td>
                      <td className="p-3 text-sm font-medium text-gray-600 text-right">
                        <div>{p.unitPrice.toLocaleString('vi-VN')}</div>
                        {p.isBuyingPriceFallback && (
                          <div className="text-[10px] font-bold text-amber-500 animate-pulse mt-0.5">
                            Cần cập nhật giá bán!
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-sm font-medium text-gray-600 text-center">{p.vatRate ?? 8}</td>
                      <td className="p-3 text-sm font-bold text-emerald-600 text-right">{p.total.toLocaleString('vi-VN')}</td>
                      {!isFormLocked && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleEditProduct(idx)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Sửa">
                              <Pencil size={16}/>
                            </button>
                            <button onClick={() => handleRemoveProduct(idx)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Xóa">
                              <Trash2 size={16}/>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {form.products.length === 0 && (
                  <tr>
                    <td colSpan={isFormLocked ? 8 : 9} className="p-6 text-sm text-gray-400 italic text-center border-b border-gray-100">
                      Chưa có sản phẩm nào. Vui lòng nhập thông tin bên dưới để thêm.
                    </td>
                  </tr>
                )}
              </tbody>
              {!isFormLocked && editingProductIdx === null && (
                <tbody className={isInput ? 'bg-blue-50/30' : 'bg-emerald-50/30'}>
                  <tr>
                    <td className="p-2 text-center text-xs font-bold" style={{ color: isInput ? '#2563eb' : '#059669' }}>*</td>
                    <td className="p-2">
                      <input 
                        value={newProduct.name} 
                        onChange={e => {
                          const val = e.target.value;
                          const updates: any = { name: val };
                          if (val) {
                            const catalogMatch = catalogProducts.find(prod => prod.name.trim().toLowerCase() === val.trim().toLowerCase());
                            const historyMatch = contracts.flatMap(c => c.products || []).find(prod => prod.name?.trim().toLowerCase() === val.trim().toLowerCase());
                            const match = catalogMatch || historyMatch;
                            if (match) {
                              if (!newProduct.unit) updates.unit = match.unit || '';
                              if (!newProduct.origin) updates.origin = match.origin || '';
                              if (!newProduct.unitPrice) {
                                let priceVal = '';
                                if ('importPrice' in match || 'salePrice' in match) {
                                  if (form.contractType === 'input' && match.importPrice) priceVal = String(match.importPrice);
                                  else if (form.contractType !== 'input' && match.salePrice) priceVal = String(match.salePrice);
                                  else if (match.defaultPrice !== undefined) priceVal = String(match.defaultPrice);
                                } else if ('unitPrice' in match) {
                                  priceVal = String(match.unitPrice);
                                }
                                if (priceVal) {
                                  updates.unitPrice = Number(priceVal.replace(/\D/g, '')).toLocaleString('vi-VN');
                                }
                              }
                            }
                          }
                          setNewProduct({...newProduct, ...updates});
                        }} 
                        placeholder="Nhập tên SP..."
                        list="product-name-suggestions"
                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white ${borderColor} ${ringColor}`}
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        value={newProduct.unit} 
                        onChange={e => setNewProduct({...newProduct, unit: e.target.value})} 
                        placeholder="VD: Cái"
                        list="product-unit-suggestions"
                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white ${borderColor} ${ringColor}`}
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        value={newProduct.origin} 
                        onChange={e => setNewProduct({...newProduct, origin: e.target.value})} 
                        placeholder="VD: VN"
                        list="product-origin-suggestions"
                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white ${borderColor} ${ringColor}`}
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        type="number" 
                        min="1" 
                        value={newProduct.quantity} 
                        onChange={e => setNewProduct({...newProduct, quantity: e.target.value})} 
                        placeholder="1"
                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white text-center ${borderColor} ${ringColor}`}
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        type="text" 
                        value={newProduct.unitPrice || ''} 
                        onChange={e => handleNumericInputChange(e, val => setNewProduct({...newProduct, unitPrice: val}))} 
                        placeholder="1.000.000"
                        list="product-price-suggestions"
                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white text-right ${borderColor} ${ringColor}`}
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        type="number" 
                        min="0" 
                        max="100" 
                        value={newProduct.vatRate} 
                        onChange={e => setNewProduct({...newProduct, vatRate: e.target.value})} 
                        placeholder="8"
                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 bg-white text-center ${borderColor} ${ringColor}`}
                      />
                    </td>
                    <td className="p-2">
                      <input 
                        type="text" 
                        readOnly 
                        disabled
                        value={((Number(newProduct.quantity) || 1) * (Number(newProduct.unitPrice.replace(/\D/g, '')) || 0)).toLocaleString('vi-VN')}
                        className={`w-full px-2 py-1.5 text-sm border border-transparent rounded-md font-bold text-right cursor-not-allowed ${
                          isInput ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      />
                    </td>
                    <td className="p-2 text-center">
                      <button 
                        onClick={handleAddProduct} 
                        disabled={!newProduct.name || !newProduct.unitPrice}
                        className={`w-full py-1.5 text-sm font-bold text-white rounded-md disabled:opacity-50 transition-colors flex items-center justify-center gap-1 shadow-sm ${btnColor}`}
                      >
                        <PlusCircle size={14}/> Thêm
                      </button>
                    </td>
                  </tr>
                </tbody>
              )}
              <tbody className="bg-emerald-50/30 border-t-2 border-emerald-200">
                <tr>
                  <td colSpan={6} className="p-3 text-right text-emerald-800 uppercase text-xs font-bold align-middle">Tổng giá trị (Trước thuế)</td>
                  <td colSpan={2} className="p-2">
                    <input type="text" value={form.preTaxValue ? form.preTaxValue.toLocaleString('vi-VN') : ''} 
                      onChange={e => handleNumericInputChange(e, val => handlePreTaxChange(Number(val.replace(/\D/g, '')) || 0))}
                      className="w-full px-3 py-1.5 text-sm border border-emerald-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white font-bold text-emerald-700 text-right"/>
                  </td>
                  {!isFormLocked && <td></td>}
                </tr>
                {(() => {
                  const vatSummary = form.products.reduce((acc: any, p: ContractProduct) => {
                    const rate = p.vatRate ?? 8;
                    acc[rate] = (acc[rate] || 0) + (p.total * rate) / 100;
                    return acc;
                  }, {});
                  const rates = Object.keys(vatSummary).map(Number).sort((a, b) => a - b);
                  if (rates.length === 0) rates.push(8);
                  
                  return rates.map(rate => (
                    <tr key={rate}>
                      <td colSpan={6} className="p-3 text-right text-emerald-800 uppercase text-xs font-bold align-middle">Thuế VAT ({rate}%)</td>
                      <td colSpan={2} className="p-2">
                        <input type="text" value={(vatSummary[rate] || 0).toLocaleString('vi-VN')} readOnly disabled
                          className="w-full px-3 py-1.5 text-sm border border-transparent rounded-md bg-white font-bold text-emerald-700 text-right cursor-not-allowed"/>
                      </td>
                      {!isFormLocked && <td></td>}
                    </tr>
                  ));
                })()}
                <tr>
                  <td colSpan={6} className="p-3 text-right text-emerald-800 uppercase text-xs font-bold align-middle">Tổng cộng (Sau thuế)</td>
                  <td colSpan={2} className="p-2">
                    <input type="text" value={form.postTaxValue ? form.postTaxValue.toLocaleString('vi-VN') : ''} readOnly disabled
                      className="w-full px-3 py-1.5 text-sm border border-transparent rounded-md bg-emerald-200/50 font-extrabold text-emerald-900 text-right cursor-not-allowed"/>
                  </td>
                  {!isFormLocked && <td></td>}
                </tr>
                <tr>
                  <td colSpan={isFormLocked ? 8 : 9} className="p-3 pt-1 border-t border-emerald-100">
                    <p className="text-sm font-medium text-emerald-800 text-right pr-[104px]">
                      <span className="italic text-gray-500 mr-2">Viết bằng chữ:</span>
                      {numToVnText(form.postTaxValue)}
                    </p>
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        {/* Đính kèm file / Tài liệu */}
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
          <div className="space-y-3">
            <label className="block text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2">
              <Paperclip size={14} /> Quản lý Tài liệu Hợp đồng Chuyên nghiệp
            </label>
            <div className="bg-white p-4 rounded-xl border border-gray-100">
              <InlineDocumentManager 
                category="contracts" 
                linkedId={form.id || editingContract?.id} 
                readOnly={isFormLocked} 
              />
            </div>
          </div>
        </div>

        {/* Checklist Hồ sơ HĐ */}
        <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2">
              📋 Checklist hồ sơ hợp đồng
            </label>
            <span className="text-xs font-bold text-amber-600">
              {CHECKLIST_ITEMS.filter(item => form.documentChecklist && form.documentChecklist[item.key]).length}/{CHECKLIST_ITEMS.length} hoàn thành
            </span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-amber-100 rounded-full h-2 mb-4 overflow-hidden">
            <div className="bg-gradient-to-r from-amber-400 to-emerald-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${(CHECKLIST_ITEMS.filter(item => form.documentChecklist && form.documentChecklist[item.key]).length / CHECKLIST_ITEMS.length) * 100}%` }}></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {CHECKLIST_ITEMS.map(item => {
              const isChecked = !!(form.documentChecklist && form.documentChecklist[item.key]);
              const isDisabled = isFormLocked || item.key === 'hoaDon';
              return (
                <div 
                  key={item.key} 
                  onClick={() => {
                    if (isDisabled) return;
                    setForm((f: any) => {
                      const currentList = f.documentChecklist || {};
                      return { ...f, documentChecklist: { ...currentList, [item.key]: !currentList[item.key] } };
                    });
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all border ${isDisabled ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'} ${isChecked ? 'bg-emerald-50 border-emerald-200 shadow-sm font-semibold' : isDisabled ? 'bg-gray-100/50 border-gray-200' : 'bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50/30'}`}
                  title={item.key === 'hoaDon' ? 'Hóa đơn tự động tích khi bấm nút Xuất hóa đơn' : undefined}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${isChecked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 bg-white'}`}>
                    {isChecked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                  </div>
                  <div>
                    <span className={`text-sm font-medium ${isChecked ? 'text-emerald-700' : 'text-gray-600'}`}>{item.label}</span>
                    {item.key === 'hoaDon' && (
                      <span className="text-[10px] text-gray-400 font-normal block leading-tight">
                        (Tích tự động khi xuất hóa đơn)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!isChecklistComplete && form.docAccountantStatus !== 'confirmed' && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 animate-in fade-in duration-300">
              <span className="text-lg flex-shrink-0">📋</span>
              <div>
                <p className="text-sm font-bold text-amber-800">Bàn giao Kế toán chưa sẵn sàng</p>
                <p className="text-xs text-amber-600 mt-0.5">Vui lòng tích đầy đủ các hạng mục trong Checklist hồ sơ hợp đồng phía trên để mở khóa tính năng Bàn giao Kế toán.</p>
              </div>
            </div>
          )}
        </div>

      </div>
      </fieldset>

      {/* Theo dõi Hồ sơ & Bàn giao Kế toán */}
      <div className="p-6 pt-0 space-y-5">
        <div className="bg-emerald-50/20 p-4 rounded-xl border border-emerald-100 space-y-3 mt-5">
          <label className="block text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2">
            📅 Theo dõi Hồ sơ & Bàn giao Kế toán
          </label>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {form.docAccountantStatus === 'confirmed' ? (
              <div className="sm:col-span-2 lg:col-span-4 bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center gap-3 shadow-sm animate-in fade-in duration-300">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-emerald-800">✅ Kế toán đã xác nhận nhận hồ sơ thành công</h4>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Hồ sơ được xác nhận bởi <span className="font-bold">{users?.find(u => u.id === form.docAccountantUserId)?.name || 'Kế toán'}</span> vào ngày {form.docAccountantDate ? new Date(form.docAccountantDate).toLocaleDateString('vi-VN') : ''}. Hợp đồng đã hoàn thành và được khóa ở chế độ chỉ đọc.
                  </p>
                </div>
              </div>
            ) : form.docAccountantUserId && currentUser && form.docAccountantUserId === currentUser.id ? (
              <div className="sm:col-span-2 lg:col-span-4 bg-amber-50 border border-amber-200 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-sm animate-in fade-in duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-800">⚠️ Bạn được bàn giao hồ sơ hợp đồng này</h4>
                    <p className="text-xs text-amber-600 mt-0.5">Vui lòng kiểm tra hồ sơ thực tế và bấm nút Xác nhận bên dưới để hoàn thành thủ tục bàn giao và khóa hợp đồng.</p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={handleConfirmReceipt}
                  disabled={confirmingReceipt}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-emerald-200 transition-all flex items-center justify-center gap-2 whitespace-nowrap self-stretch sm:self-center"
                >
                  {confirmingReceipt ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>✓ Xác nhận đã nhận hồ sơ</>
                  )}
                </button>
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Ngày gửi hồ sơ</label>
              <input 
                type="date"
                value={form.docSentDate || ''} 
                disabled={isHandoverDisabled}
                onChange={e => setForm((f: any) => ({...f, docSentDate: e.target.value}))} 
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-gray-700 font-medium disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Ngày nhận lại hồ sơ</label>
              <input 
                type="date"
                value={form.docReceivedDate || ''} 
                disabled={isHandoverDisabled}
                onChange={e => setForm((f: any) => ({...f, docReceivedDate: e.target.value}))} 
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-gray-700 font-medium disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Người nhận hồ sơ</label>
              <input 
                type="text"
                placeholder="Tên người nhận hồ sơ..."
                value={form.docReceiver || ''} 
                disabled={isHandoverDisabled}
                onChange={e => setForm((f: any) => ({...f, docReceiver: e.target.value}))} 
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-gray-700 font-medium disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">Kế toán nhận bàn giao</label>
              <select 
                value={form.docAccountantUserId || ''} 
                onChange={e => setForm((f: any) => ({...f, docAccountantUserId: e.target.value}))} 
                disabled={isHandoverDisabled}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-gray-700 font-medium disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">-- Chọn kế toán --</option>
                {accountantUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.department || 'Phòng Kế toán'})</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
      
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
        <button onClick={() => setActiveTab(form.contractType === 'input' ? 'input' : 'output')} className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors">← Quay lại</button>
        <div className="flex gap-3">
          {editingContract && !readOnly && (
            <button onClick={() => {
              const style = document.createElement('style');
              style.innerHTML = `@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; left: 0; top: 0; width: 100%; } }`;
              document.head.appendChild(style);
              window.print();
              setTimeout(() => document.head.removeChild(style), 1000);
            }} className="px-5 py-2.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors flex items-center gap-2">
              <FileText size={16}/> In HĐ
            </button>
          )}
          <button onClick={() => setActiveTab(form.contractType === 'input' ? 'input' : 'output')} className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors pointer-events-auto">
            {isFormLocked ? 'Đóng' : 'Hủy'}
          </button>
          {!isFormLocked && (
            <button onClick={handleSave} disabled={!form.contractNumber || !form.clientName || !form.contractName || saving}
              className="px-6 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl hover:shadow-lg hover:shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {saving ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Đang lưu...</>
              ) : (
                <><Save size={16}/> {editingContract ? 'Cập nhật' : 'Lưu Hợp đồng'}</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Product Suggestions Datalists */}
      <datalist id="product-name-suggestions">
        {Array.from(new Set([
          ...catalogProducts.map(p => p.name.trim()),
          ...contracts.flatMap(c => c.products || []).map(p => p.name?.trim())
        ].filter(Boolean))).sort().map(val => (
          <option key={val} value={val} />
        ))}
      </datalist>
      <datalist id="product-unit-suggestions">
        {Array.from(new Set([
          ...catalogProducts.filter(p => !newProduct.name || p.name.trim().toLowerCase() === newProduct.name.trim().toLowerCase()).map(p => p.unit?.trim()),
          ...contracts.flatMap(c => c.products || []).filter(p => !newProduct.name || p.name?.trim().toLowerCase() === newProduct.name.trim().toLowerCase()).map(p => p.unit?.trim())
        ].filter(Boolean))).sort().map(val => (
          <option key={val} value={val} />
        ))}
      </datalist>
      <datalist id="product-origin-suggestions">
        {Array.from(new Set([
          ...catalogProducts.filter(p => !newProduct.name || p.name.trim().toLowerCase() === newProduct.name.trim().toLowerCase()).map(p => p.origin?.trim()),
          ...contracts.flatMap(c => c.products || []).filter(p => !newProduct.name || p.name?.trim().toLowerCase() === newProduct.name.trim().toLowerCase()).map(p => p.origin?.trim())
        ].filter(Boolean))).sort().map(val => (
          <option key={val} value={val} />
        ))}
      </datalist>
      <datalist id="product-price-suggestions">
        {Array.from(new Set(contracts.flatMap(c => c.products || [])
          .filter(p => !newProduct.name || p.name?.trim().toLowerCase() === newProduct.name.trim().toLowerCase())
          .map(p => Number(p.unitPrice)).filter(v => !isNaN(v) && v > 0)
        )).sort((a, b) => a - b).map(val => (
          <option key={val} value={val.toLocaleString('vi-VN')} />
        ))}
      </datalist>

      <WarehousePickerModal
        isOpen={showWarehousePicker}
        onClose={() => setShowWarehousePicker(false)}
        products={catalogProducts}
        contracts={contracts}
        onSelect={handleSelectFromWarehouse}
      />
      <InputContractPickerModal
        isOpen={showInputPicker}
        onClose={() => setShowInputPicker(false)}
        contracts={contracts}
        allContracts={contracts}
        editingContractId={editingContract?.id}
        onSelect={handleSelectFromInputContract}
      />
    </div>
  );
};
