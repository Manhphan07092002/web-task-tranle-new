import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/UI';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { 
  PlusCircle, Search, FileText, Trash2, X, Save, Send, CheckCircle, XCircle, 
  DollarSign, CalendarDays, Clock, Download, Building2, History,
  ArrowUpRight, BarChart3, TrendingUp, ChevronDown, ChevronUp, Info, List, Award, Calendar
} from 'lucide-react';
import { RevenueReport } from '../../services/revenueService';
import { Contract } from '../../services/contractService';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend, LabelList } from 'recharts';
import { fmtMoney, formatCompactVND, makeYAxisFormatter, getWeekRange, getMonthRange, getWeekInfo, getContractVatRate, computeDeliveredValue, getAssignees, getDeduplicatedTotals, buildInvoicedCsv, buildHistoryCsv, getTodayParts } from './revenueUtils.js';




interface RevenueRow {
  contractId: string;
  contractNumber: string;
  clientName: string;
  contractName: string;
  preTaxValue: number;
  vatRate: number;
  deliveredMonth: number;
  deliveredCumulative: number;
  invoiceDate: string;
  invoiceNumber: string;
  assignee?: string;
  contractType?: 'input' | 'output';
}

const RevenuePage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { contracts, revenueReports, users, departments, saveRevenueReport, deleteRevenueReport, roles } = useData();
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'history' | 'invoiced' | 'periodic'>('list');
  const [originTab, setOriginTab] = useState<'list' | 'history'>('list');
  const [search, setSearch] = useState('');

  // Sync activeTab with URL 'tab' parameter
  const queryTab = new URLSearchParams(location.search).get('tab');
  useEffect(() => {
    if (queryTab === 'list' || queryTab === 'create' || queryTab === 'history' || queryTab === 'invoiced' || queryTab === 'periodic') {
      setActiveTab(queryTab);
    }
  }, [queryTab]);

  // History states & hooks
  const [historyYear, setHistoryYear] = useState<number>(() => new Date().getFullYear());
  const [historyType, setHistoryType] = useState<'weekly' | 'monthly'>('monthly');
  const [historySearch, setHistorySearch] = useState('');
  const [historyDept, setHistoryDept] = useState('all');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyMode, setHistoryMode] = useState('all');
  const [historySort, setHistorySort] = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest');

  // Invoiced tab states
  const [invoicedSearch, setInvoicedSearch] = useState('');
  const [invoicedStart, setInvoicedStart] = useState('');
  const [invoicedEnd, setInvoicedEnd] = useState('');
  const [invoicedDept, setInvoicedDept] = useState('all');

  // Periodic tab states
  const [periodicType, setPeriodicType] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [periodicYear, setPeriodicYear] = useState<number>(() => new Date().getFullYear());
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  const availableYears = useMemo(() => {
    const years = revenueReports.map(r => {
      const date = r.periodStart || r.createdAt;
      return new Date(date).getFullYear();
    });
    return [...new Set(years)].sort((a, b) => b - a);
  }, [revenueReports]);

  const activeYear = availableYears.includes(historyYear) ? historyYear : (availableYears[0] || new Date().getFullYear());

  useEffect(() => {
    if (location.state && (location.state as any).action === 'create') {
      setActiveTab('create');
    }
  }, [location.state]);

  const invoicedContractsList = useMemo(() => {
    return contracts.filter(c => {
      // Only output contracts
      if (c.contractType !== 'output' && c.contractType) return false;
      // Must have invoice date and invoice number
      if (!c.invoiceDate || !c.invoiceNumber) return false;
      // Must not be deleted
      if (c.isDeleted !== undefined && c.isDeleted !== 0 && c.isDeleted !== null) return false;

      // Search filter: clientName, contractNumber, contractName, invoiceNumber
      if (invoicedSearch.trim()) {
        const q = invoicedSearch.toLowerCase();
        const matchClient = (c.clientName || '').toLowerCase().includes(q);
        const matchNum = (c.contractNumber || '').toLowerCase().includes(q);
        const matchName = (c.contractName || '').toLowerCase().includes(q);
        const matchInv = (c.invoiceNumber || '').toLowerCase().includes(q);
        if (!matchClient && !matchNum && !matchName && !matchInv) return false;
      }

      // Date filters
      if (invoicedStart && c.invoiceDate < invoicedStart) return false;
      if (invoicedEnd && c.invoiceDate > invoicedEnd) return false;

      // Dept filter
      if (invoicedDept !== 'all' && c.department !== invoicedDept) return false;

      return true;
    }).map(c => {
      const deliveredValue = computeDeliveredValue(c);

      return {
        ...c,
        deliveredValue
      };
    });
  }, [contracts, invoicedSearch, invoicedStart, invoicedEnd, invoicedDept]);

  const exportInvoicedToCSV = () => {
    if (invoicedContractsList.length === 0) return;
    const csvContent = buildInvoicedCsv(invoicedContractsList);
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `HD_Da_Xuat_Hoa_Don.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const periodicData = useMemo(() => {
    const allInvoiced = contracts.filter(c => {
      if (c.contractType !== 'output' && c.contractType) return false;
      if (!c.invoiceDate || !c.invoiceNumber) return false;
      if (c.isDeleted !== undefined && c.isDeleted !== 0 && c.isDeleted !== null) return false;
      return true;
    }).map(c => {
      const deliveredValue = computeDeliveredValue(c);

      return {
        ...c,
        deliveredValue
      };
    });

    // Today's date components (live date via getTodayParts — do NOT hardcode)
    const { todayStr, todayWeek, todayMonth, todayYear } = getTodayParts();

    let revenueThisWeek = 0;
    let revenueThisMonth = 0;
    let revenueThisYear = 0;

    const weeklyMap: Record<string, { label: string; revenue: number; contracts: typeof allInvoiced; mondayStr: string; year: number }> = {};
    const monthlyMap: Record<string, { label: string; revenue: number; contracts: typeof allInvoiced; year: number }> = {};
    const yearlyMap: Record<string, { label: string; revenue: number; contracts: typeof allInvoiced; year: number }> = {};

    allInvoiced.forEach(c => {
      const val = c.deliveredValue;
      const dateStr = c.invoiceDate!;
      const year = new Date(dateStr).getFullYear();

      // aggregates
      const wInfo = getWeekInfo(dateStr);
      if (wInfo.mondayStr === todayWeek.mondayStr) {
        revenueThisWeek += val;
      }
      if (dateStr.startsWith(todayMonth)) {
        revenueThisMonth += val;
      }
      if (year === todayYear) {
        revenueThisYear += val;
      }

      // weekly
      const weekKey = wInfo.weekRange;
      if (!weeklyMap[weekKey]) {
        weeklyMap[weekKey] = { label: `Tuần ${wInfo.weekNum} (${wInfo.weekRange})`, revenue: 0, contracts: [], mondayStr: wInfo.mondayStr, year: wInfo.year };
      }
      weeklyMap[weekKey].revenue += val;
      weeklyMap[weekKey].contracts.push(c);

      // monthly
      const monthKey = dateStr.substring(0, 7);
      const monthParts = monthKey.split('-');
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = { label: `Tháng ${monthParts[1]}/${monthParts[0]}`, revenue: 0, contracts: [], year };
      }
      monthlyMap[monthKey].revenue += val;
      monthlyMap[monthKey].contracts.push(c);

      // yearly
      const yearKey = String(year);
      if (!yearlyMap[yearKey]) {
        yearlyMap[yearKey] = { label: `Năm ${yearKey}`, revenue: 0, contracts: [], year };
      }
      yearlyMap[yearKey].revenue += val;
      yearlyMap[yearKey].contracts.push(c);
    });

    const weeklyList = Object.entries(weeklyMap)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.mondayStr.localeCompare(a.mondayStr));

    const monthlyList = Object.entries(monthlyMap)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.key.localeCompare(a.key));

    const yearlyList = Object.entries(yearlyMap)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.key.localeCompare(a.key));

    return {
      revenueThisWeek,
      revenueThisMonth,
      revenueThisYear,
      weeklyList,
      monthlyList,
      yearlyList
    };
  }, [contracts]);

  const [editingReport, setEditingReport] = useState<RevenueReport | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewReport, setViewReport] = useState<RevenueReport | null>(null);

  // Form
  const [reportType, setReportType] = useState<'weekly' | 'monthly'>('monthly');
  const [generationMode, setGenerationMode] = useState<'automatic' | 'manual'>('manual');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [managerFeedback, setManagerFeedback] = useState('');
  const [directorFeedback, setDirectorFeedback] = useState('');

  // Use fresh permissions from /api/users (always joins roles table) instead of stale localStorage cache
  const currentUserData = users.find((u: any) => u.id === user?.id);
  const perms: string[] = (currentUserData?.permissions as string[]) || user?.permissions || [];

  const canCreate = perms.includes('create_revenue_report') || perms.includes('create_report') || user?.role === 'Admin';
  // Mirror task report: if TP can approve CV reports, they can approve revenue reports too
  const canApprove = perms.includes('approve_dept_revenue') || perms.includes('approve_dept_reports') || perms.includes('approve_all_revenue') || user?.role === 'Admin';
  const canViewAll = perms.includes('view_all_reports') || perms.includes('director_feedback') || perms.includes('approve_all_revenue') || user?.role === 'Admin';
  const isDirector = perms.includes('approve_all_revenue') || perms.includes('director_feedback') || user?.role === 'Admin';
  const userDept = user?.department || '';

  const [subTab, setSubTab] = useState<'mine' | 'pending' | 'dept'>('mine');


  useEffect(() => {
    if (canViewAll) {
      setSubTab('pending');
    } else if (canApprove) {
      setSubTab('dept'); // Manager: default to department view
    } else {
      setSubTab('mine');
    }
  }, [canViewAll, canApprove]);


  const isAuthor = editingReport?.authorId === user?.id;
  // Mirror isPendingMgrReview from ReportModal
  const isManagerReview = canApprove && !isDirector && editingReport?.status === 'Pending Manager' && !isAuthor;
  const isDirectorReview = isDirector && editingReport?.status === 'Pending Director';
  const isReadOnly = editingReport && !(isAuthor && ['Draft', 'Rejected'].includes(editingReport.status)) && !isManagerReview && !isDirectorReview;

  const getUserName = (id: string) => users.find(u => u.id === id)?.name || id;

  // History selectors & export
  const historicalReports = useMemo(() => {
    let list = revenueReports.filter(r => {
      const date = r.periodStart || r.createdAt;
      const year = new Date(date).getFullYear();
      
      // 1. Year check
      if (year !== activeYear) return false;
      
      // 2. Type check
      if (r.reportType !== historyType) return false;

      // 3. Dept visibility constraint
      if (!canViewAll && r.department !== userDept && r.authorId !== user?.id) return false;
      
      // 4. Custom Dept Filter
      if (historyDept !== 'all' && r.department !== historyDept) return false;
      
      // 5. Status Filter
      if (historyStatus === 'all') {
        if (r.status !== 'Approved' && r.status !== 'Rejected') return false;
      } else {
        if (r.status !== historyStatus) return false;
      }
      
      // 6. Mode Filter
      if (historyMode !== 'all' && (r.generationMode || 'manual') !== historyMode) return false;
      
      // 7. Search query filter (title, department, or creator name)
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase();
        const creatorName = users.find(u => u.id === r.authorId)?.name || '';
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchDept = (r.department || '').toLowerCase().includes(q);
        const matchCreator = creatorName.toLowerCase().includes(q);
        if (!matchTitle && !matchDept && !matchCreator) return false;
      }
      
      return true;
    });

    // 8. Sorting
    list = [...list].sort((a, b) => {
      if (historySort === 'newest') {
        return b.periodStart.localeCompare(a.periodStart);
      }
      if (historySort === 'oldest') {
        return a.periodStart.localeCompare(b.periodStart);
      }
      if (historySort === 'highest') {
        return b.totalDelivered - a.totalDelivered;
      }
      if (historySort === 'lowest') {
        return a.totalDelivered - b.totalDelivered;
      }
      return 0;
    });

    return list;
  }, [revenueReports, activeYear, historyType, canViewAll, userDept, user?.id, historyDept, historyStatus, historyMode, historySearch, historySort, users]);

  const groupedWeeklyReports = useMemo(() => {
    if (historyType !== 'weekly') return {};
    const groups: Record<string, RevenueReport[]> = {};
    historicalReports.forEach(r => {
      const date = new Date(r.periodStart || r.createdAt);
      const monthLabel = `Tháng ${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      (groups[monthLabel] ??= []).push(r);
    });
    return groups;
  }, [historicalReports, historyType]);


  const historyStats = useMemo(() => {
    const count = historicalReports.length;
    // Only count APPROVED reports for revenue totals, deduplicated by contractId
    const approvedReports = historicalReports.filter(r => r.status === 'Approved');
    const { totalDelivered, totalPreTax, maxReport } = getDeduplicatedTotals(approvedReports);
    
    const approvedCount = historicalReports.filter(r => r.status === 'Approved').length;
    const pendingCount = historicalReports.filter(r => r.status.startsWith('Pending')).length;
    const draftCount = historicalReports.filter(r => r.status === 'Draft').length;

    return {
      count,
      totalDelivered,
      totalPreTax,
      maxReport,
      approvedCount,
      pendingCount,
      draftCount
    };
  }, [historicalReports]);


  const exportHistoryToCSV = () => {
    if (historicalReports.length === 0) return;
    
    const csvContent = buildHistoryCsv(historicalReports, users);
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Lich_su_doanh_thu_${historyType}_${activeYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (generationMode === 'automatic' && !isReadOnly && periodStart && periodEnd) {
      const dept = editingReport?.department || userDept;
      const filtered = contracts.filter(c => {
        return (
          (c.contractType === 'output' || !c.contractType) &&
          c.department === dept &&
          c.invoiceDate &&
          c.invoiceDate >= periodStart &&
          c.invoiceDate <= periodEnd &&
          (c.isDeleted === undefined || c.isDeleted === 0 || !c.isDeleted)
        );
      });

      const mappedRows = filtered.map(c => {
        const invoiceVal = computeDeliveredValue(c);

        return {
          contractId: c.id,
          contractNumber: c.contractNumber,
          clientName: c.clientName,
          contractName: c.contractName,
          preTaxValue: Number(c.preTaxValue) || 0,
          vatRate: getContractVatRate(c),
          deliveredMonth: invoiceVal,
          deliveredCumulative: Number(c.paidAmount) || 0,
          invoiceDate: c.invoiceDate || '',
          invoiceNumber: c.invoiceNumber || '',
          assignee: getUserName(c.createdBy || '') || undefined,
          contractType: (c.contractType || 'output') as 'input' | 'output',
        };
      });

      setRows(mappedRows);
    }
  }, [generationMode, isReadOnly, periodStart, periodEnd, contracts, editingReport?.department, userDept, users]);

  const visibleReports = useMemo(() => {
    let list = revenueReports;
    if (!canViewAll) {
      list = list.filter(r => r.department === userDept || r.authorId === user?.id);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => r.title.toLowerCase().includes(q));
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [revenueReports, search, canViewAll, userDept, user?.id]);

  const subTabCounts = useMemo(() => {
    let list = revenueReports;
    if (!canViewAll) {
      list = list.filter(r => r.department === userDept || r.authorId === user?.id);
    }

    const mine = list.filter(r => r.authorId === user?.id && r.status !== 'Approved' && r.status !== 'Rejected').length;
    const dept = (canApprove && !canViewAll) ? list.length : 0; // All dept reports for manager
    
    let pending = 0;
    if (canViewAll) {
      pending = list.filter(r => r.status.startsWith('Pending')).length;
    } else if (canApprove) {
      pending = list.filter(r => r.status === 'Pending Manager' && r.authorId !== user?.id).length;
    } else {
      pending = list.filter(r => r.authorId === user?.id && r.status.startsWith('Pending')).length;
    }

    return { mine, pending, dept };
  }, [revenueReports, canViewAll, canApprove, userDept, user?.id]);


  const displayedActiveReports = useMemo(() => {
    let list = visibleReports;

    if (subTab === 'mine') {
      list = list.filter(r => r.authorId === user?.id && r.status !== 'Approved' && r.status !== 'Rejected');
    } else if (subTab === 'dept') {
      // Manager sees ALL dept reports (including approved/rejected) to have full picture
      list = list; // visibleReports already filtered by dept
    } else if (subTab === 'pending') {
      if (canViewAll) {
        list = list.filter(r => r.status.startsWith('Pending'));
      } else if (canApprove) {
        list = list.filter(r => r.status === 'Pending Manager' && r.authorId !== user?.id);
      } else {
        list = list.filter(r => r.authorId === user?.id && r.status.startsWith('Pending'));
      }
    }

    return list;
  }, [visibleReports, subTab, canViewAll, canApprove, user?.id]);


  const generationBadge = (mode: string) => {
    const map: Record<string, string> = {
      automatic: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
      manual: 'bg-amber-50 text-amber-700 border border-amber-200',
    };
    const labels: Record<string, string> = {
      automatic: 'Tự động',
      manual: 'Thủ công',
    };
    return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${map[mode] || 'bg-gray-50 text-gray-500'}`}>{labels[mode] || mode}</span>;
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      Draft: 'bg-gray-100 text-gray-600', 'Pending Manager': 'bg-amber-100 text-amber-700',
      'Pending Director': 'bg-blue-100 text-blue-700', Approved: 'bg-green-100 text-green-700', Rejected: 'bg-red-100 text-red-600',
    };
    const labels: Record<string, string> = {
      Draft: 'Nháp', 'Pending Manager': 'Chờ TP duyệt', 'Pending Director': 'Chờ GĐ duyệt', Approved: 'Đã duyệt', Rejected: 'Từ chối',
    };
    return <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${map[s] || 'bg-gray-100 text-gray-500'}`}>{labels[s] || s}</span>;
  };

  const addContractRow = (c: Contract) => {
    if (rows.find(r => r.contractId === c.id)) return;
    setRows(prev => [...prev, {
      contractId: c.id, contractNumber: c.contractNumber, clientName: c.clientName,
      contractName: c.contractName, preTaxValue: Number(c.preTaxValue) || 0,
      vatRate: getContractVatRate(c),
      deliveredMonth: 0,
      deliveredCumulative: Number(c.paidAmount) || 0, invoiceDate: c.invoiceDate || '', invoiceNumber: c.invoiceNumber || '',
      assignee: getUserName(c.createdBy || '') || undefined,
      contractType: (c.contractType || 'output') as 'input' | 'output',
    }]);
  };

  const updateRow = (idx: number, field: keyof RevenueRow, value: any) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));

  const totalPreTax = rows.reduce((s, r) => s + r.preTaxValue, 0);
  const totalVAT = rows.reduce((s, r) => s + Math.round(r.preTaxValue * (r.vatRate || 8) / 100), 0);
  const totalPostTax = totalPreTax + totalVAT;
  const totalDelivered = rows.reduce((s, r) => s + r.deliveredMonth, 0);
  const totalCumulative = rows.reduce((s, r) => s + r.deliveredCumulative, 0);

  const handleSave = async (status: string) => {
    const now = new Date().toISOString();
    const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    const titleLabel = reportType === 'weekly'
      ? (periodStart && periodEnd
          ? `tuần ${fmtDate(new Date(periodStart))} – ${fmtDate(new Date(periodEnd))}/${new Date(periodEnd).getFullYear()}`
          : 'tuần hiện tại')
      : (periodStart
          ? new Date(periodStart).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
          : '');
    const report: RevenueReport = {
      id: editingReport?.id || Math.random().toString(36).slice(2, 9),
      title: editingReport?.title || `Báo cáo doanh thu ${titleLabel}`,
      reportType, periodStart, periodEnd,
      generationMode,
      content: JSON.stringify(rows),
      totalPreTax, totalDelivered, totalCumulative,
      authorId: editingReport?.authorId || user?.id || '',
      department: editingReport?.department || userDept,
      status,
      approvedBy: editingReport?.approvedBy,
      approvedAt: editingReport?.approvedAt,
      managerFeedback: managerFeedback || editingReport?.managerFeedback,
      directorFeedback: directorFeedback || editingReport?.directorFeedback,
      createdAt: editingReport?.createdAt || now,
      submittedAt: status.startsWith('Pending') ? now : editingReport?.submittedAt,
    };
    if (status === 'Approved' || status === 'Rejected') {
      report.approvedBy = user?.id;
      report.approvedAt = now;
    }
    const isNewReport = !editingReport;
    await saveRevenueReport({ ...report, _isNew: isNewReport });
    setActiveTab(originTab);
    setEditingReport(null);
  };

  const openEdit = (r: RevenueReport) => {
    setEditingReport(r);
    setReportType(r.reportType);
    setGenerationMode(r.generationMode || 'manual');
    setPeriodStart(r.periodStart);
    setPeriodEnd(r.periodEnd);
    setManagerFeedback(r.managerFeedback || '');
    setDirectorFeedback(r.directorFeedback || '');
    try {
      const parsed: any[] = JSON.parse(r.content || '[]');
      const withVat = parsed.map((row: any) => ({
        ...row,
        vatRate: row.vatRate ?? (contracts.find(c => c.id === row.contractId)?.vatRate || 8),
      }));
      setRows(withVat);
    } catch { setRows([]); }
    setOriginTab(activeTab === 'history' ? 'history' : 'list');
    setActiveTab('create');
  };

  const openCreate = () => {
    setEditingReport(null);
    setReportType('monthly');
    setGenerationMode('manual');
    const m = getMonthRange();
    setPeriodStart(m.start);
    setPeriodEnd(m.end);
    setRows([]);
    setManagerFeedback(''); setDirectorFeedback('');
    setOriginTab('list');
    setActiveTab('create');
  };

  const handleReportTypeChange = (type: 'weekly' | 'monthly') => {
    setReportType(type);
    if (!editingReport) {
      if (type === 'weekly') {
        const w = getWeekRange();
        setPeriodStart(w.start);
        setPeriodEnd(w.end);
      } else {
        const m = getMonthRange();
        setPeriodStart(m.start);
        setPeriodEnd(m.end);
      }
    }
  };

  const chartData = useMemo(() => {
    const dataByMonth: Record<string, number> = {};
    const dataByDept: Record<string, number> = {};
    
    visibleReports.forEach(r => {
      if (r.status !== 'Approved') return;
      if (r.reportType !== 'monthly') return; // Tránh cộng dồn trùng lặp báo cáo tuần với báo cáo tháng
      const d = new Date(r.createdAt);
      const m = `T${d.getMonth() + 1}`;
      dataByMonth[m] = (dataByMonth[m] || 0) + r.totalDelivered;
      
      const dept = r.department || 'Khác';
      dataByDept[dept] = (dataByDept[dept] || 0) + r.totalDelivered;
    });

    return {
      monthly: Object.entries(dataByMonth).map(([name, value]) => ({ name, value })),
      dept: Object.entries(dataByDept).map(([name, value]) => ({ name, value }))
    };
  }, [visibleReports]);

  const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899'];

  const barYFormatter = makeYAxisFormatter(chartData.monthly);


  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-200">
              <DollarSign size={20} className="text-white" />
            </div>
            Báo cáo Doanh thu
          </h1>
          <p className="text-sm text-gray-500 mt-1">Theo dõi doanh thu theo tuần và tháng</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'create' ? (
            <Button variant="secondary" onClick={() => setActiveTab('list')} size="sm">← Quay lại</Button>
          ) : (
            <div className="flex flex-wrap bg-gray-100/80 p-1 rounded-2xl border border-gray-200/50 shadow-sm">
              <button
                onClick={() => setActiveTab('list')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all ${
                  activeTab === 'list'
                    ? 'bg-white text-orange-600 shadow-sm border-transparent'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <FileText size={16} />
                Báo cáo
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all ${
                  activeTab === 'history'
                    ? 'bg-white text-orange-600 shadow-sm border-transparent'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <History size={16} />
                Lịch sử
              </button>
              <button
                onClick={() => setActiveTab('invoiced')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all ${
                  activeTab === 'invoiced'
                    ? 'bg-white text-orange-600 shadow-sm border-transparent'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <ArrowUpRight size={16} />
                HĐ đã xuất HĐ
              </button>
              <button
                onClick={() => setActiveTab('periodic')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all ${
                  activeTab === 'periodic'
                    ? 'bg-white text-orange-600 shadow-sm border-transparent'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Calendar size={16} />
                Doanh thu theo kỳ
              </button>
            </div>
          )}
        </div>
      </div>

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Tổng Doanh Thu</p>
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><DollarSign size={16} /></div>
              </div>
              <h3 className="text-2xl font-black text-gray-800">{(() => {
                const approvedMonthly = visibleReports.filter(r => r.reportType === 'monthly' && r.status === 'Approved');
                const { totalDelivered } = getDeduplicatedTotals(approvedMonthly);
                return formatCompactVND(totalDelivered);
              })()}</h3>
              <p className="text-xs text-emerald-600 font-medium mt-1">Từ {visibleReports.filter(r => r.reportType === 'monthly' && r.status === 'Approved').length} báo cáo tháng đã duyệt</p>
            </div>
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Chờ Phê Duyệt</p>
                <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><Clock size={16} /></div>
              </div>
              <h3 className="text-2xl font-black text-gray-800">{visibleReports.filter(r => r.status.startsWith('Pending') || r.status === 'MgrApproved').length}</h3>
              <p className="text-xs text-gray-400 mt-1">Báo cáo đang chờ</p>
            </div>
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Đã Phê Duyệt</p>
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center"><CheckCircle size={16} /></div>
              </div>
              <h3 className="text-2xl font-black text-gray-800">{visibleReports.filter(r => r.status === 'Approved').length}</h3>
              <p className="text-xs text-gray-400 mt-1">Báo cáo hoàn tất</p>
            </div>
            {canCreate && (
              <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-3xl p-5 shadow-lg shadow-orange-200 text-white flex flex-col justify-center items-center cursor-pointer hover:shadow-orange-300 transition-all hover:-translate-y-1" onClick={openCreate}>
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center mb-2"><PlusCircle size={20} /></div>
                <span className="font-bold text-sm">Tạo báo cáo mới</span>
              </div>
            )}
          </div>

          {/* Analytics Charts */}
          {visibleReports.some(r => r.status === 'Approved') && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Bar Chart */}
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Doanh thu theo tháng</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Báo cáo đã được phê duyệt</p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <BarChart3 size={16} />
                  </div>
                </div>
                <div className="h-56">
                  {chartData.monthly.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#059669" stopOpacity={0.7} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280', fontWeight: 600 }} />
                        <YAxis tickFormatter={barYFormatter} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} width={55} />
                        <Tooltip
                          cursor={{ fill: '#f0fdf4', radius: 6 }}
                          formatter={(val: any) => [fmtMoney(Number(val)), 'Doanh thu']}
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', fontSize: 12 }}
                        />
                        <Bar dataKey="value" fill="url(#barGradient)" radius={[8, 8, 0, 0]} barSize={36} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Pie Chart */}
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Tỷ trọng theo Phòng ban</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Doanh thu đã duyệt theo đơn vị</p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                    <TrendingUp size={16} />
                  </div>
                </div>
                {chartData.dept.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                ) : (
                  <div className="flex items-center gap-4 h-56">
                    <div className="flex-1 h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={chartData.dept}
                            dataKey="value"
                            nameKey="name"
                            cx="50%" cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={3}
                          >
                            {chartData.dept.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="white" strokeWidth={2} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(val: any, name: any) => {
                              const total = chartData.dept.reduce((s, d) => s + d.value, 0);
                              const pct = total > 0 ? ((Number(val) / total) * 100).toFixed(1) : '0';
                              return [`${fmtMoney(Number(val))} (${pct}%)`, name];
                            }}
                            contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', fontSize: 12 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-2.5 min-w-[100px]">
                      {chartData.dept.map((d, i) => {
                        const total = chartData.dept.reduce((s, x) => s + x.value, 0);
                        const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                        return (
                          <div key={d.name} className="flex items-start gap-2">
                            <div className="w-3 h-3 rounded-sm mt-0.5 flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <div>
                              <p className="text-xs font-semibold text-gray-700 leading-tight">{d.name}</p>
                              <p className="text-[10px] text-gray-400">{pct}%</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}


          {/* Sub Tab Bar */}
          <div className="flex gap-1 border-b border-gray-150 overflow-x-auto pb-px">
            {(!canViewAll) && (
              <button
                className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${subTab === 'mine' ? 'border-orange-500 text-orange-600 font-extrabold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSubTab('mine')}
              >
                <FileText size={15} /> Báo cáo của tôi
                <span className="bg-gray-150 text-gray-600 text-[11px] px-1.5 py-0.5 rounded-full font-bold">{subTabCounts.mine}</span>
              </button>
            )}
            {(canApprove && !canViewAll) && (
              <button
                className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${subTab === 'dept' ? 'border-orange-500 text-orange-600 font-extrabold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSubTab('dept')}
              >
                <Building2 size={15} /> Phòng ban
                <span className="bg-gray-150 text-gray-600 text-[11px] px-1.5 py-0.5 rounded-full font-bold">{subTabCounts.dept}</span>
              </button>
            )}
            {(canViewAll || canApprove) && (
              <button
                className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${subTab === 'pending' ? 'border-orange-500 text-orange-600 font-extrabold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSubTab('pending')}
              >
                <Clock size={15} /> Cần duyệt
                {subTabCounts.pending > 0 ? (
                  <span className="bg-red-500 text-white text-[11px] px-1.5 py-0.5 rounded-full animate-pulse">{subTabCounts.pending}</span>
                ) : (
                  <span className="bg-gray-150 text-gray-600 text-[11px] px-1.5 py-0.5 rounded-full font-bold">{subTabCounts.pending}</span>
                )}
              </button>
            )}
          </div>


          <div className="flex items-center justify-between">
            <div className="relative w-full max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Tìm kiếm báo cáo..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white shadow-sm" />
            </div>
          </div>

          {displayedActiveReports.length === 0 ? (
            <div className="py-24 text-center text-gray-400 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <DollarSign size={44} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium">
                {subTab === 'mine' && 'Bạn chưa tự lập báo cáo doanh thu hoạt động nào'}
                {subTab === 'dept' && 'Phòng ban chưa có báo cáo doanh thu nào'}
                {subTab === 'pending' && 'Không có báo cáo doanh thu nào đang chờ duyệt'}

              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {displayedActiveReports.map(r => (
                <div key={r.id} onClick={() => openEdit(r)} className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-orange-100 hover:border-orange-200 transition-all cursor-pointer p-5 group flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${r.status === 'Approved' ? 'bg-green-100 text-green-600' : r.status === 'Rejected' ? 'bg-red-100 text-red-500' : r.status === 'MgrApproved' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-gray-800 text-sm group-hover:text-orange-600 transition-colors truncate max-w-[150px] sm:max-w-none">{r.title}</p>
                          {generationBadge(r.generationMode || 'manual')}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            r.reportType === 'weekly'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-violet-50 text-violet-700 border-violet-200'
                          }`}>
                            {r.reportType === 'weekly' ? 'Theo tuần' : 'Theo tháng'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-1">
                            <CalendarDays size={10} />
                            {r.periodStart ? new Date(r.periodStart).toLocaleDateString('vi-VN') : new Date(r.createdAt).toLocaleDateString('vi-VN')}
                            {r.periodEnd && r.periodStart !== r.periodEnd && (
                              <> – {new Date(r.periodEnd).toLocaleDateString('vi-VN')}</>
                            )}
                          </span>
                          <span className="opacity-40">•</span>
                          <span className="flex items-center gap-1"><Building2 size={10} /> {r.department || 'Chưa phân phòng'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0">{statusBadge(r.status)}</div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-gray-50 flex justify-between items-end">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 font-bold">Người TH</p>
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const assignees = getAssignees(r);
                          if (assignees.length === 0) {
                            return (
                              <>
                                {users.find(u => u.id === r.authorId)?.avatar ? (
                                  <img src={users.find(u => u.id === r.authorId)!.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 border border-orange-100 flex items-center justify-center text-[10px] font-bold">
                                    {getUserName(r.authorId).charAt(0)}
                                  </div>
                                )}
                                <span className="text-xs font-semibold text-gray-700">{getUserName(r.authorId)}</span>
                              </>
                            );
                          }
                          return (
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {assignees.slice(0, 3).map((name, i) => {
                                  const u = users.find(user => user.name === name);
                                  return u?.avatar ? (
                                    <img key={i} src={u.avatar} className="w-6 h-6 rounded-full object-cover border border-white relative z-10 shadow-sm" alt="" />
                                  ) : (
                                    <div key={i} className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 border border-white shadow-sm flex items-center justify-center text-[10px] font-bold relative z-10">
                                      {name.charAt(0)}
                                    </div>
                                  );
                                })}
                              </div>
                              <span className="text-xs font-semibold text-gray-700 truncate max-w-[120px]" title={assignees.join(', ')}>
                                {assignees.length > 1 ? `${assignees[0]} +${assignees.length - 1}` : assignees[0]}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5 font-bold">Doanh thu kỳ</p>
                      <p className="text-lg font-black text-emerald-600">{formatCompactVND(r.totalPreTax)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* INVOICED CONTRACTS TAB */}
      {activeTab === 'invoiced' && (
        <div className="space-y-6">
          {/* Statistics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">HĐ Đã Xuất Hóa Đơn</p>
                <h3 className="text-2xl font-black text-gray-800">{invoicedContractsList.length} Hợp đồng</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Khớp với bộ lọc hiện tại</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
                <FileText size={22} />
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Doanh thu đã xuất</p>
                <h3 className="text-2xl font-black text-emerald-600">
                  {fmtMoney(invoicedContractsList.reduce((sum, c) => sum + (c.deliveredValue || 0), 0))}
                </h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Lũy kế giá trị xuất hóa đơn</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <DollarSign size={22} />
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Lũy kế thanh toán</p>
                <h3 className="text-2xl font-black text-indigo-600">
                  {fmtMoney(invoicedContractsList.reduce((sum, c) => sum + (Number(c.paidAmount) || 0), 0))}
                </h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Đã thu hồi công nợ</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Award size={22} />
              </div>
            </div>
          </div>

          {/* Filtering Panel */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-gray-800 text-base">Danh sách hợp đồng đã xuất hóa đơn</h3>
                <p className="text-xs text-gray-400 mt-0.5">Lọc danh sách các hợp đồng bán có thông tin hóa đơn</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportInvoicedToCSV}
                  disabled={invoicedContractsList.length === 0}
                  className="flex items-center gap-1.5 font-bold"
                >
                  <Download size={14} /> Xuất CSV
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Search size={14} />
                </span>
                <input
                  type="text"
                  placeholder="Mã HĐ, Khách hàng, Số HĐ..."
                  value={invoicedSearch}
                  onChange={e => setInvoicedSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-2xl text-xs focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-gray-50/50"
                />
              </div>

              {/* Department */}
              <select
                value={invoicedDept}
                onChange={e => setInvoicedDept(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-2xl text-xs focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-gray-50/50"
              >
                <option value="all">Tất cả phòng ban</option>
                {departments.map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>

              {/* Start Date */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 font-bold uppercase shrink-0">Từ ngày</span>
                <input
                  type="date"
                  value={invoicedStart}
                  onChange={e => setInvoicedStart(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-2xl text-xs focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-gray-50/50"
                />
              </div>

              {/* End Date */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 font-bold uppercase shrink-0">Đến ngày</span>
                <input
                  type="date"
                  value={invoicedEnd}
                  onChange={e => setInvoicedEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-2xl text-xs focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-gray-50/50"
                />
              </div>
            </div>
          </div>

          {/* Table Grid */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            {invoicedContractsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="w-16 h-16 rounded-3xl bg-gray-50 text-gray-400 flex items-center justify-center mb-4">
                  <FileText size={28} />
                </div>
                <p className="font-semibold text-gray-700">Không tìm thấy hợp đồng đã xuất hóa đơn nào</p>
                <p className="text-xs text-gray-400 mt-1">Vui lòng điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50/55 border-b border-gray-100">
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Hợp đồng</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Chủ đầu tư</th>
                      <th className="px-4 py-3.5 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Thông tin Hóa đơn</th>
                      <th className="px-4 py-3.5 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">Giá trị HĐ</th>
                      <th className="px-4 py-3.5 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">Doanh thu đã xuất</th>
                      <th className="px-4 py-3.5 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">Đã thanh toán</th>
                      <th className="px-4 py-3.5 text-center text-[10px] font-bold text-gray-500 uppercase tracking-wider">Tiến độ xuất</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100/70 text-xs">
                    {invoicedContractsList.map(c => {
                      const progress = c.preTaxValue ? Math.min(100, Math.max(0, ((c.deliveredValue || 0) / c.preTaxValue) * 100)) : 0;
                      return (
                        <tr key={c.id} className="hover:bg-gray-50/40 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="font-bold text-gray-900">{c.contractNumber}</div>
                            <div className="text-gray-500 max-w-[200px] truncate" title={c.contractName}>{c.contractName}</div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="font-medium text-gray-700 truncate max-w-[150px]" title={c.clientName || ''}>
                              {c.clientName || 'N/A'}
                            </div>
                            <div className="mt-0.5">
                              <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-[9px] font-bold border border-orange-100">
                                {c.department || 'N/A'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-gray-800">No. {c.invoiceNumber}</span>
                            </div>
                            <div className="text-gray-400 text-[10px] flex items-center gap-1 mt-0.5">
                              <Clock size={10} /> {c.invoiceDate}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right font-semibold text-gray-700">
                            {fmtMoney(Number(c.preTaxValue) || 0)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-black text-emerald-600">
                            {fmtMoney(c.deliveredValue || 0)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-semibold text-indigo-600">
                            {fmtMoney(Number(c.paidAmount) || 0)}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className="font-bold text-[10px] text-gray-600">{progress.toFixed(0)}%</span>
                              <div className="w-16 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className="bg-emerald-500 h-full rounded-full" 
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PERIODIC REVENUE TAB */}
      {activeTab === 'periodic' && (
        <div className="space-y-6">
          {/* Header Controls and Mini Stats */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-gray-800 text-base">Thống kê doanh thu theo kỳ</h3>
                <p className="text-xs text-gray-400 mt-0.5">Tổng hợp doanh thu đã xuất hóa đơn theo tuần, tháng và năm</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="bg-gray-100 p-1 rounded-xl flex gap-1 border border-gray-200/50">
                  <button
                    onClick={() => setPeriodicType('weekly')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      periodicType === 'weekly'
                        ? 'bg-white text-orange-600 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Tuần
                  </button>
                  <button
                    onClick={() => setPeriodicType('monthly')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      periodicType === 'monthly'
                        ? 'bg-white text-orange-600 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Tháng
                  </button>
                  <button
                    onClick={() => setPeriodicType('yearly')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      periodicType === 'yearly'
                        ? 'bg-white text-orange-600 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Năm
                  </button>
                </div>

                {periodicType !== 'yearly' && (
                  <select
                    value={periodicYear}
                    onChange={e => setPeriodicYear(Number(e.target.value))}
                    className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white text-gray-700 focus:ring-orange-500"
                  >
                    {[2026, 2025, 2024, 2023].map(y => (
                      <option key={y} value={y}>Năm {y}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 rounded-2xl border border-emerald-100/50 p-4 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-emerald-800/80 font-bold uppercase tracking-wider">Tuần này</p>
                  <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <TrendingUp size={12} />
                  </div>
                </div>
                <h4 className="text-xl font-black text-emerald-700">{formatCompactVND(periodicData.revenueThisWeek)}</h4>
                <p className="text-[9px] text-emerald-600/70 mt-0.5">Hóa đơn xuất trong tuần hiện tại</p>
              </div>

              <div className="bg-gradient-to-br from-orange-50 to-amber-50/50 rounded-2xl border border-orange-100/50 p-4 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-orange-800/80 font-bold uppercase tracking-wider">Tháng này</p>
                  <div className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center">
                    <CalendarDays size={12} />
                  </div>
                </div>
                <h4 className="text-xl font-black text-orange-700">{formatCompactVND(periodicData.revenueThisMonth)}</h4>
                <p className="text-[9px] text-orange-600/70 mt-0.5">Doanh thu luỹ kế tháng hiện tại</p>
              </div>

              <div className="bg-gradient-to-br from-indigo-50 to-blue-50/50 rounded-2xl border border-indigo-100/50 p-4 shadow-2xs">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-indigo-800/80 font-bold uppercase tracking-wider">Năm nay (2026)</p>
                  <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center">
                    <DollarSign size={12} />
                  </div>
                </div>
                <h4 className="text-xl font-black text-indigo-700">{formatCompactVND(periodicData.revenueThisYear)}</h4>
                <p className="text-[9px] text-indigo-600/70 mt-0.5">Tổng lũy kế trong năm nay</p>
              </div>
            </div>
          </div>

          {/* Graphical Representation Card */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <h4 className="font-extrabold text-gray-800 text-sm mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-orange-500" />
              Biểu đồ trực quan doanh thu ({periodicType === 'weekly' ? 'Tuần' : periodicType === 'monthly' ? 'Tháng' : 'Năm'})
            </h4>

            {(() => {
              // Filter data by year if not yearly
              const rawList = 
                periodicType === 'weekly' 
                  ? periodicData.weeklyList.filter(item => item.year === periodicYear)
                  : periodicType === 'monthly'
                    ? periodicData.monthlyList.filter(item => item.year === periodicYear)
                    : periodicData.yearlyList;

              // Slice latest items for visual clarity
              const chartList = [...rawList].reverse().slice(-12);

              if (chartList.length === 0) {
                return (
                  <div className="h-64 flex flex-col items-center justify-center bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                    <BarChart3 size={32} className="text-gray-300 mb-2" />
                    <p className="text-xs text-gray-400">Không có dữ liệu trong khoảng thời gian này</p>
                  </div>
                );
              }

              // Transform for chart compatibility
              const formattedData = chartList.map(item => ({
                name: periodicType === 'weekly' 
                  ? item.key.split('(')[0].trim() 
                  : periodicType === 'monthly' 
                    ? item.label.replace('Tháng ', 'T') 
                    : item.label,
                DoanhThu: item.revenue,
                rawRevenue: item.revenue
              }));

              return (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 'bold' }} stroke="#9ca3af" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fontWeight: 'bold' }} stroke="#9ca3af" axisLine={false} tickLine={false} tickFormatter={(v) => formatCompactVND(v).replace(' ₫','')} />
                      <Tooltip
                        cursor={{ fill: 'rgba(249, 115, 22, 0.05)' }}
                        formatter={(val: any) => [fmtMoney(val), 'Doanh thu']}
                        contentStyle={{
                          background: 'rgba(255, 255, 255, 0.95)',
                          borderRadius: '16px',
                          border: '1px solid #f3f4f6',
                          fontSize: '11px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                          fontWeight: 'bold'
                        }}
                      />
                      <Bar dataKey="DoanhThu" fill="url(#colorRevenue)" radius={[6, 6, 0, 0]}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f97316" stopOpacity={0.9}/>
                            <stop offset="95%" stopColor="#ea580c" stopOpacity={0.6}/>
                          </linearGradient>
                        </defs>
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </div>

          {/* Tabulated breakdown list */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h4 className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                <List size={16} className="text-orange-500" />
                Bảng phân rã chi tiết doanh thu
              </h4>
              <span className="text-[10px] text-gray-400 font-bold bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                Nhấp vào hàng để xem danh sách hợp đồng
              </span>
            </div>

            {(() => {
              const displayList = 
                periodicType === 'weekly' 
                  ? periodicData.weeklyList.filter(item => item.year === periodicYear)
                  : periodicType === 'monthly'
                    ? periodicData.monthlyList.filter(item => item.year === periodicYear)
                    : periodicData.yearlyList;

              if (displayList.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                    <div className="w-16 h-16 rounded-3xl bg-gray-50 text-gray-400 flex items-center justify-center mb-4">
                      <Calendar size={28} />
                    </div>
                    <p className="font-semibold text-gray-700">Chưa có dữ liệu thống kê kỳ nào</p>
                    <p className="text-xs text-gray-400 mt-1">Không tìm thấy hợp đồng xuất hóa đơn trong bộ lọc đã chọn.</p>
                  </div>
                );
              }

              return (
                <div className="divide-y divide-gray-100">
                  {displayList.map(item => {
                    const isExpanded = expandedPeriod === item.key;
                    return (
                      <div key={item.key} className="transition-all">
                        {/* Main Period Row */}
                        <div 
                          onClick={() => setExpandedPeriod(isExpanded ? null : item.key)}
                          className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/40 cursor-pointer select-none transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                              {periodicType === 'weekly' ? <Clock size={16} /> : periodicType === 'monthly' ? <CalendarDays size={16} /> : <DollarSign size={16} />}
                            </div>
                            <div>
                              <div className="font-bold text-gray-800 text-xs">{item.label}</div>
                              <div className="text-[10px] text-gray-400 mt-0.5">{item.contracts.length} hợp đồng phát sinh doanh thu</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="font-black text-emerald-600 text-sm">{fmtMoney(item.revenue)}</div>
                              <div className="text-[9px] text-gray-400">Doanh thu thực nhận</div>
                            </div>
                            <div className="text-gray-400">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                          </div>
                        </div>

                        {/* Collapsible Sub-table of contracts */}
                        {isExpanded && (
                          <div className="bg-gray-50/30 px-6 py-3 border-t border-b border-gray-100/60 animate-in slide-in-from-top-2 duration-150">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-gray-200/50 text-[10px] text-gray-400 uppercase font-bold">
                                    <th className="py-2">Mã Hợp đồng</th>
                                    <th className="py-2">Tên hợp đồng</th>
                                    <th className="py-2">Khách hàng</th>
                                    <th className="py-2">Hóa đơn</th>
                                    <th className="py-2 text-right">Doanh thu nhận</th>
                                  </tr>
                                </thead>
                                <tbody className="text-[11px] font-medium divide-y divide-gray-100/50 text-gray-600">
                                  {item.contracts.map(c => (
                                    <tr key={c.id} className="hover:bg-white/50 transition-colors">
                                      <td className="py-2 font-bold text-gray-800">{c.contractNumber}</td>
                                      <td className="py-2 max-w-[200px] truncate" title={c.contractName}>{c.contractName}</td>
                                      <td className="py-2">{c.clientName || 'N/A'}</td>
                                      <td className="py-2 text-[10px]">
                                        <span className="font-semibold text-gray-700">No. {c.invoiceNumber}</span>
                                        <span className="text-gray-400 block mt-0.5">{c.invoiceDate}</span>
                                      </td>
                                      <td className="py-2 text-right font-black text-emerald-600">{fmtMoney(c.deliveredValue || 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Historical Statistics Summary Panel */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Doanh thu Lịch sử</p>
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <DollarSign size={16} />
                </div>
              </div>
              <h3 className="text-xl font-black text-gray-800">{fmtMoney(historyStats.totalDelivered)}</h3>
              <p className="text-[10px] text-gray-400 mt-1">Của {historyStats.count} báo cáo thỏa mãn bộ lọc</p>
            </div>
            
            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Doanh thu trước thuế</p>
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                  <Building2 size={16} />
                </div>
              </div>
              <h3 className="text-xl font-black text-gray-800">{fmtMoney(historyStats.totalPreTax)}</h3>
              <p className="text-[10px] text-gray-400 mt-1">Lũy kế trước thuế VAT</p>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Báo cáo lớn nhất</p>
                <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                  <FileText size={16} />
                </div>
              </div>
              <h3 className="text-xl font-black text-gray-800">{fmtMoney(historyStats.maxReport)}</h3>
              <p className="text-[10px] text-gray-400 mt-1">Giá trị báo cáo lớn nhất</p>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-xs">
              <div className="flex justify-between items-start mb-2">
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Trạng thái phê duyệt</p>
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                  <Clock size={16} />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-md border border-green-100">{historyStats.approvedCount} duyệt</span>
                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">{historyStats.pendingCount} chờ</span>
                <span className="text-xs font-bold text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded-md border border-gray-100">{historyStats.draftCount} nháp</span>
              </div>
            </div>
          </div>

          {/* Smart Filter & Export Controls */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-4">
            {/* Row 1: Basic selectors (Year, Type) + Export */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-gray-50 pb-4">
              <div className="flex flex-wrap items-center gap-4">
                {/* Year Capsules */}
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-1">Năm:</span>
                  {availableYears.length === 0 ? (
                    <button className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm border-transparent">
                      {new Date().getFullYear()}
                    </button>
                  ) : (
                    availableYears.map(year => (
                      <button
                        key={year}
                        onClick={() => setHistoryYear(year)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                          activeYear === year
                            ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white border-transparent shadow-sm shadow-orange-200'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {year}
                      </button>
                    ))
                  )}
                </div>

                {/* Type toggle */}
                <div className="flex bg-gray-100/80 p-0.5 rounded-xl border border-gray-200/50">
                  <button
                    onClick={() => setHistoryType('monthly')}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      historyType === 'monthly'
                        ? 'bg-white text-orange-600 shadow-xs border-transparent'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Tháng
                  </button>
                  <button
                    onClick={() => setHistoryType('weekly')}
                    className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      historyType === 'weekly'
                        ? 'bg-white text-orange-600 shadow-xs border-transparent'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Tuần
                  </button>
                </div>
              </div>

              {/* Export Button */}
              <button
                onClick={exportHistoryToCSV}
                disabled={historicalReports.length === 0}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <Download size={14} />
                Xuất Excel / CSV
              </button>
            </div>

            {/* Row 2: Search + Advanced Filters + Sorting */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Search Bar */}
              <div className="relative col-span-1 lg:col-span-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Tìm theo tiêu đề, phòng ban, người lập..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                />
              </div>

              {/* Department Filter */}
              <div>
                <select
                  value={historyDept}
                  onChange={e => setHistoryDept(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium text-gray-700 bg-white"
                >
                  <option value="all">Tất cả Phòng ban</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <select
                  value={historyStatus}
                  onChange={e => setHistoryStatus(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium text-gray-700 bg-white"
                >
                  <option value="all">Tất cả Trạng thái</option>
                  <option value="Approved">Đã duyệt</option>
                  <option value="Rejected">Từ chối</option>
                </select>
              </div>

              {/* Generation Mode Filter */}
              <div>
                <select
                  value={historyMode}
                  onChange={e => setHistoryMode(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium text-gray-700 bg-white"
                >
                  <option value="all">Tất cả Phương thức lập</option>
                  <option value="automatic">Tự động</option>
                  <option value="manual">Thủ công</option>
                </select>
              </div>
            </div>

            {/* Row 3: Sort Options */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-50">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{historicalReports.length}</span> kết quả phù hợp
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">Sắp xếp:</span>
                <select
                  value={historySort}
                  onChange={e => setHistorySort(e.target.value as any)}
                  className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500 font-semibold text-gray-700 bg-white"
                >
                  <option value="newest">Ngày tạo (Mới nhất)</option>
                  <option value="oldest">Ngày tạo (Cũ nhất)</option>
                  <option value="highest">Doanh thu (Cao nhất)</option>
                  <option value="lowest">Doanh thu (Thấp nhất)</option>
                </select>
              </div>
            </div>
          </div>

          {/* History List/Groups */}
          {historicalReports.length === 0 ? (
            <div className="py-24 text-center text-gray-400 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <History size={44} className="mx-auto mb-3 opacity-20" />
              <p className="font-semibold">Không tìm thấy báo cáo lịch sử nào</p>
              <p className="text-xs text-gray-400 mt-1">Chọn năm hoặc loại báo cáo khác để xem lịch sử.</p>
            </div>
          ) : historyType === 'monthly' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {historicalReports.map(r => (
                <div key={r.id} onClick={() => openEdit(r)} className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-orange-100 hover:border-orange-200 transition-all cursor-pointer p-5 group flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${r.status === 'Approved' ? 'bg-green-100 text-green-600' : r.status === 'Rejected' ? 'bg-red-100 text-red-500' : r.status === 'MgrApproved' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-gray-800 text-sm group-hover:text-orange-600 transition-colors truncate max-w-[150px] sm:max-w-none">{r.title}</p>
                          {generationBadge(r.generationMode || 'manual')}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            r.reportType === 'weekly'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-violet-50 text-violet-700 border-violet-200'
                          }`}>
                            {r.reportType === 'weekly' ? 'Theo tuần' : 'Theo tháng'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-1">
                            <CalendarDays size={10} />
                            {r.periodStart ? new Date(r.periodStart).toLocaleDateString('vi-VN') : new Date(r.createdAt).toLocaleDateString('vi-VN')}
                            {r.periodEnd && r.periodStart !== r.periodEnd && (
                              <> – {new Date(r.periodEnd).toLocaleDateString('vi-VN')}</>
                            )}
                          </span>
                          <span className="opacity-40">•</span>
                          <span className="flex items-center gap-1"><Building2 size={10} /> {r.department || 'Chưa phân phòng'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0">{statusBadge(r.status)}</div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-gray-50 flex justify-between items-end">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 font-bold">Người TH</p>
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const assignees = getAssignees(r);
                          if (assignees.length === 0) {
                            return (
                              <>
                                {users.find(u => u.id === r.authorId)?.avatar ? (
                                  <img src={users.find(u => u.id === r.authorId)!.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 border border-orange-100 flex items-center justify-center text-[10px] font-bold">
                                    {getUserName(r.authorId).charAt(0)}
                                  </div>
                                )}
                                <span className="text-xs font-semibold text-gray-700">{getUserName(r.authorId)}</span>
                              </>
                            );
                          }
                          return (
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {assignees.slice(0, 3).map((name, i) => {
                                  const u = users.find(user => user.name === name);
                                  return u?.avatar ? (
                                    <img key={i} src={u.avatar} className="w-6 h-6 rounded-full object-cover border border-white relative z-10 shadow-sm" alt="" />
                                  ) : (
                                    <div key={i} className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 border border-white shadow-sm flex items-center justify-center text-[10px] font-bold relative z-10">
                                      {name.charAt(0)}
                                    </div>
                                  );
                                })}
                              </div>
                              <span className="text-xs font-semibold text-gray-700 truncate max-w-[120px]" title={assignees.join(', ')}>
                                {assignees.length > 1 ? `${assignees[0]} +${assignees.length - 1}` : assignees[0]}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5 font-bold">Doanh thu kỳ</p>
                      <p className="text-lg font-black text-emerald-600">{formatCompactVND(r.totalPreTax)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedWeeklyReports).map(([monthLabel, reports]) => {
                const groupTotal = reports.filter(r => r.status === 'Approved').reduce((sum, r) => sum + r.totalDelivered, 0);

                return (
                  <div key={monthLabel} className="space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-200 pb-2 bg-gray-50/95 backdrop-blur-md py-2 sticky top-0 z-10">
                      <h3 className="text-base font-extrabold text-gray-800 flex items-center gap-2">
                        <CalendarDays size={18} className="text-orange-500" />
                        {monthLabel}
                      </h3>
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                        Tổng tháng: {fmtMoney(groupTotal)}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                      {reports.map(r => (
                        <div key={r.id} onClick={() => openEdit(r)} className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-orange-100 hover:border-orange-200 transition-all cursor-pointer p-5 group flex flex-col h-full">
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${r.status === 'Approved' ? 'bg-green-100 text-green-600' : r.status === 'Rejected' ? 'bg-red-100 text-red-500' : r.status === 'MgrApproved' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                <FileText size={18} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-bold text-gray-800 text-sm group-hover:text-orange-600 transition-colors truncate max-w-[150px] sm:max-w-none">{r.title}</p>
                                  {generationBadge(r.generationMode || 'manual')}
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                    r.reportType === 'weekly'
                                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                                      : 'bg-violet-50 text-violet-700 border-violet-200'
                                  }`}>
                                    {r.reportType === 'weekly' ? 'Theo tuần' : 'Theo tháng'}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-400 flex items-center gap-2 mt-1">
                                  <span className="flex items-center gap-1">
                                    <CalendarDays size={10} />
                                    {r.periodStart ? new Date(r.periodStart).toLocaleDateString('vi-VN') : new Date(r.createdAt).toLocaleDateString('vi-VN')}
                                    {r.periodEnd && r.periodStart !== r.periodEnd && (
                                      <> – {new Date(r.periodEnd).toLocaleDateString('vi-VN')}</>
                                    )}
                                  </span>
                                  <span className="opacity-40">•</span>
                                  <span className="flex items-center gap-1"><Building2 size={10} /> {r.department || 'Chưa phân phòng'}</span>
                                </p>
                              </div>
                            </div>
                            <div className="flex-shrink-0">{statusBadge(r.status)}</div>
                          </div>

                          <div className="mt-auto pt-4 border-t border-gray-50 flex justify-between items-end">
                            <div>
                              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 font-bold">Người TH</p>
                              <div className="flex items-center gap-1.5">
                                {(() => {
                                  const assignees = getAssignees(r);
                                  if (assignees.length === 0) {
                                    return (
                                      <>
                                        {users.find(u => u.id === r.authorId)?.avatar ? (
                                          <img src={users.find(u => u.id === r.authorId)!.avatar} className="w-6 h-6 rounded-full object-cover" alt="" />
                                        ) : (
                                          <div className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 border border-orange-100 flex items-center justify-center text-[10px] font-bold">
                                            {getUserName(r.authorId).charAt(0)}
                                          </div>
                                        )}
                                        <span className="text-xs font-semibold text-gray-700">{getUserName(r.authorId)}</span>
                                      </>
                                    );
                                  }
                                  return (
                                    <div className="flex items-center gap-2">
                                      <div className="flex -space-x-2">
                                        {assignees.slice(0, 3).map((name, i) => {
                                          const u = users.find(user => user.name === name);
                                          return u?.avatar ? (
                                            <img key={i} src={u.avatar} className="w-6 h-6 rounded-full object-cover border border-white relative z-10 shadow-sm" alt="" />
                                          ) : (
                                            <div key={i} className="w-6 h-6 rounded-full bg-orange-50 text-orange-600 border border-white shadow-sm flex items-center justify-center text-[10px] font-bold relative z-10">
                                              {name.charAt(0)}
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <span className="text-xs font-semibold text-gray-700 truncate max-w-[120px]" title={assignees.join(', ')}>
                                        {assignees.length > 1 ? `${assignees[0]} +${assignees.length - 1}` : assignees[0]}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5 font-bold">Doanh thu kỳ</p>
                              <p className="text-lg font-black text-emerald-600">{formatCompactVND(r.totalPreTax)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CREATE/EDIT TAB */}
      {activeTab === 'create' && (
        <div className="space-y-5">
          {/* Period */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Phương thức lập</label>
                <select value={generationMode} onChange={e => setGenerationMode(e.target.value as any)} disabled={!!isReadOnly}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 font-medium">
                  <option value="manual">Thủ công</option>
                  <option value="automatic">Tự động</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Loại báo cáo</label>
                <select value={reportType} onChange={e => handleReportTypeChange(e.target.value as any)} disabled={!!isReadOnly}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500">
                  <option value="monthly">Theo tháng</option>
                  <option value="weekly">Theo tuần</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Từ ngày</label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} disabled={!!isReadOnly}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Đến ngày</label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} disabled={!!isReadOnly}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
          </div>

          {/* Add contracts */}
          {!isReadOnly && (
            generationMode === 'manual' ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Thêm hợp đồng từ danh sách</h3>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-2">
                  {contracts
                    .filter(c => c.contractType === 'output' || !c.contractType) // Default to output if not specified
                    .filter(c => !rows.find(r => r.contractId === c.id))
                    .map(c => (
                      <button key={c.id} onClick={() => addContractRow(c)}
                        className={`text-xs px-3 py-1.5 border rounded-lg transition-colors truncate max-w-[250px] text-left flex items-center gap-1.5 ${
                          c.contractType === 'input' 
                            ? 'bg-fuchsia-50/50 border-fuchsia-200 hover:bg-fuchsia-100 text-fuchsia-900'
                            : 'bg-blue-50/50 border-blue-200 hover:bg-blue-100 text-blue-900'
                        }`}>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          c.contractType === 'input' ? 'bg-fuchsia-200 text-fuchsia-800' : 'bg-blue-200 text-blue-800'
                        }`}>
                          {c.contractType === 'input' ? 'MUA' : 'BÁN'}
                        </span>
                        <span className="truncate">{c.contractNumber} — {c.clientName}</span>
                      </button>
                    ))}
                  {contracts.length === 0 && <p className="text-xs text-gray-400">Chưa có hợp đồng. Vui lòng thêm hợp đồng trước.</p>}
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-600">
                    <DollarSign size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-indigo-900">Phương thức lập Tự động (Automatic)</h3>
                    <p className="text-xs text-indigo-700/80 mt-0.5">Báo cáo sẽ tự động truy vấn và tổng hợp tất cả các hợp đồng bán có xuất hóa đơn trong khoảng thời gian đã chọn.</p>
                  </div>
                </div>
              </div>
            )
          )}

          {/* Revenue table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-gradient-to-r from-orange-500 to-red-600 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">BÁO CÁO DOANH THU</h3>
              <span className="text-xs opacity-80">{rows.length} hợp đồng</span>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-center w-10">STT</th>
                    {rows.some(r => r.assignee) && <th className="px-3 py-2 text-xs font-bold text-gray-600 text-left">Người TH</th>}
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-left">Số HĐ</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-left">Chủ đầu tư</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-left">Tên HĐ</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-right">Giá trị trước thuế</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-right w-32">Doanh thu tháng</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-right w-32">Lũy kế</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-center">Ngày XHĐ</th>
                    <th className="px-3 py-2 text-xs font-bold text-gray-600 text-center">Số HĐ</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-orange-50/20">
                      <td className="px-3 py-2 text-center text-gray-500">{idx + 1}</td>
                      {rows.some(ro => ro.assignee) && <td className="px-3 py-2 font-medium text-blue-600 text-xs">{r.assignee || '—'}</td>}
                      <td className="px-3 py-2 font-semibold text-gray-800 text-xs whitespace-nowrap">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] mr-1.5 font-bold ${
                          r.contractType === 'input' ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {r.contractType === 'input' ? 'MUA' : 'BÁN'}
                        </span>
                        {r.contractNumber}
                      </td>
                      <td className="px-3 py-2 text-gray-700 text-xs">{r.clientName}</td>
                      <td className="px-3 py-2 text-gray-700 text-xs max-w-[180px] truncate" title={r.contractName}>{r.contractName}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmtMoney(r.preTaxValue)}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" value={r.deliveredMonth} onChange={e => updateRow(idx, 'deliveredMonth', Number(e.target.value))} disabled={!!isReadOnly || generationMode === 'automatic'}
                          className="w-full text-right text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none transition-shadow disabled:bg-gray-50 disabled:text-gray-600" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" value={r.deliveredCumulative} onChange={e => updateRow(idx, 'deliveredCumulative', Number(e.target.value))} disabled={!!isReadOnly || generationMode === 'automatic'}
                          className="w-full text-right text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none transition-shadow disabled:bg-gray-50 disabled:text-gray-600" />
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-gray-600">{r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('vi-VN') : '—'}</td>
                      <td className="px-3 py-2 text-center text-xs text-gray-600">{r.invoiceNumber || '—'}</td>
                      <td className="px-3 py-2">
                        {!isReadOnly && generationMode !== 'automatic' && (
                          <button onClick={() => removeRow(idx)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-gray-400 text-sm">
                        {generationMode === 'automatic' ? 'Không có hợp đồng nào được xuất hóa đơn trong khoảng thời gian này.' : 'Chưa có hợp đồng nào được thêm.'}
                      </td>
                    </tr>
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-orange-50 border-t-2 border-orange-200 font-bold">
                      <td colSpan={rows.some(r => r.assignee) ? 5 : 4} className="px-3 py-2 text-right text-orange-800">Tổng trước thuế:</td>
                      <td className="px-3 py-2 text-right text-orange-800">{fmtMoney(totalPreTax)}</td>
                      <td className="px-3 py-2 text-right text-orange-800">{fmtMoney(totalDelivered)}</td>
                      <td className="px-3 py-2 text-right text-orange-800">{fmtMoney(totalCumulative)}</td>
                      <td colSpan={3}></td>
                    </tr>
                    <tr className="bg-amber-50">
                      <td colSpan={rows.some(r => r.assignee) ? 5 : 4} className="px-3 py-2 text-right text-amber-800 font-semibold text-xs">
                        Thuế VAT ({rows.length > 0 ? (rows.some(r => r.vatRate !== rows[0].vatRate) ? 'hỗn hợp' : `${rows[0].vatRate ?? 8}%`) : '8%'}):
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-amber-800">{fmtMoney(totalVAT)}</td>
                      <td colSpan={5}></td>
                    </tr>
                    <tr className="bg-orange-100/70 border-t border-orange-300">
                      <td colSpan={rows.some(r => r.assignee) ? 5 : 4} className="px-3 py-2 text-right text-orange-900 font-extrabold text-xs">Tổng sau thuế:</td>
                      <td className="px-3 py-2 text-right font-extrabold text-orange-900">{fmtMoney(totalPostTax)}</td>
                      <td colSpan={5}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Feedback sections */}
          {(editingReport?.managerFeedback || isManagerReview || (canApprove && editingReport && editingReport.authorId !== user?.id)) && (
            <div className="bg-gradient-to-br from-orange-50/80 to-orange-100/30 border border-orange-200/60 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-orange-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                Ý kiến Trưởng phòng
              </h3>
              <textarea value={managerFeedback} onChange={e => setManagerFeedback(e.target.value)} disabled={!isManagerReview} rows={2} placeholder="Nhập ý kiến..." className="w-full resize-none text-sm text-gray-800 bg-white/60 border border-orange-200/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:bg-white transition-all disabled:opacity-70 disabled:cursor-default" />
            </div>
          )}

          {(editingReport?.directorFeedback || isDirectorReview || (editingReport?.status === 'Approved' && editingReport?.authorId !== user?.id && canViewAll && !isManagerReview)) && (
            <div className="bg-gradient-to-br from-indigo-50/80 to-indigo-100/30 border border-indigo-200/60 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                Ý kiến Giám đốc
              </h3>
              <textarea value={directorFeedback} onChange={e => setDirectorFeedback(e.target.value)} disabled={!isDirectorReview && !(editingReport?.status === 'Approved' && editingReport?.authorId !== user?.id && canViewAll && !isManagerReview)} rows={2} placeholder="Nhập ý kiến..." className="w-full resize-none text-sm text-gray-800 bg-white/60 border border-indigo-200/50 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white transition-all disabled:opacity-70 disabled:cursor-default" />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <button onClick={() => { setActiveTab(originTab); setEditingReport(null); }} className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">← Quay lại</button>
            <div className="flex gap-2">
              {(isAuthor || !editingReport) && !isReadOnly && (
                <>
                  {editingReport && editingReport.status === 'Draft' && (
                    <button onClick={() => setDeleteId(editingReport.id)} className="px-5 py-2.5 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-colors flex items-center gap-2 mr-auto">
                      <Trash2 size={16} /> Xóa báo cáo
                    </button>
                  )}
                  <button onClick={() => handleSave('Draft')} className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-2">
                    <Save size={16} /> Lưu nháp
                  </button>
                  <button onClick={() => handleSave(canApprove ? 'Pending Director' : 'Pending Manager')} disabled={rows.length === 0} className="px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-red-600 rounded-xl hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2">
                    <Send size={16} /> {editingReport?.status?.startsWith('Pending') ? 'Cập nhật' : (canApprove ? 'Gửi GĐ duyệt' : 'Gửi TP duyệt')}
                  </button>
                </>
              )}
              {isManagerReview && (
                <>
                  <button onClick={() => handleSave('Rejected')} className="px-5 py-2.5 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                    Từ chối
                  </button>
                  <button onClick={() => handleSave('Pending Director')} className="px-5 py-2.5 text-sm font-bold text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors">
                    Duyệt & gửi GĐ
                  </button>
                </>
              )}
              {isDirectorReview && (
                <>
                  <button onClick={() => handleSave('Rejected')} className="px-5 py-2.5 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                    Từ chối
                  </button>
                  <button onClick={() => handleSave('Approved')} className="px-5 py-2.5 text-sm font-bold text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors">
                    Phê duyệt
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog isOpen={!!deleteId} title="Xóa báo cáo" message="Bạn có chắc muốn xóa báo cáo này?" onConfirm={async () => { if (deleteId) { await deleteRevenueReport(deleteId); setDeleteId(null); } }} onCancel={() => setDeleteId(null)} type="danger" confirmText="Xóa" cancelText="Hủy" />
    </div>
  );
};

export default RevenuePage;
