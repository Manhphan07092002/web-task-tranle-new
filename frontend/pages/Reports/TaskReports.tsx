import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { Button, Card, Avatar } from '../../components/UI';
import { PlusCircle, FileText, CheckCircle, Clock, XCircle, FileEdit, Download, Printer, CalendarDays, Building2, Trash2, Search, Filter, PieChart, BarChart, History, Timer, Users, DollarSign } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip, BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { ReportModal } from './ReportModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Report } from '../../types';
import { exportXlsx } from '../../utils/exportXlsx';
import { RevenueReportModal } from './RevenueReportModal';
import { Pagination } from '../../components/Pagination';

export default function ReportsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { reports, revenueReports, tasks, users, roles, departments, contracts, projects, saveReport, deleteReport, adminHardDeleteReport, saveRevenueReport, saveContract, saveProject } = useData();
  const { user } = useAuth();
  const { refresh: refreshNotifications, showToast, pushLocalNotification } = useNotifications();

  // ── All hooks must be called before any conditional return ──
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRevenueModalOpen, setIsRevenueModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [filterDept, setFilterDept] = useState<string>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'task' | 'revenue'>('all');
  const [historyDeptFilter, setHistoryDeptFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [historyWeeksShown, setHistoryWeeksShown] = useState(4);
  const [devMode, setDevMode] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  // Use fresh permissions from /api/users (always joins roles table) instead of stale localStorage cache
  const currentUserData = users.find((u: any) => u.id === user?.id);
  const perms: string[] = (currentUserData?.permissions as string[]) || user?.permissions || [];


  const canApprove = perms.includes('approve_dept_reports') || perms.includes('approve_dept_revenue') || perms.includes('approve_all_revenue');
  const canViewAll = perms.includes('view_all_reports');
  const canCreate = perms.includes('create_report');

  const currentWeekStartStr = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon);
    return mon.toISOString().split('T')[0];
  }, []);

  const getReportWeekInfo = (r: any) => {
    const d = new Date(r.createdAt);
    const day = d.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (dt: Date) => dt.toISOString().split('T')[0];
    const fmtDisp = (dt: Date) => {
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}`;
    };

    const weekStartStr = fmt(mon);

    if (r.reportType) {
      if (r.reportType === 'monthly') {
        const pd = new Date(r.periodStart || r.createdAt);
        return { start: weekStartStr, label: `Tháng ${pd.getMonth() + 1}/${pd.getFullYear()}` };
      }
      return { start: weekStartStr, label: `Tuần ${fmtDisp(mon)} – ${fmtDisp(sun)}` };
    }

    try {
      const c = JSON.parse(r.content);
      if (c.weekStart && c.weekEnd) {
        return { start: c.weekStart, label: `Tuần ${c.weekStart.split('-').reverse().join('/')} – ${c.weekEnd.split('-').reverse().join('/')}` };
      }
    } catch { }

    return { start: weekStartStr, label: `Tuần ${fmtDisp(mon)} – ${fmtDisp(sun)}` };
  };

  // Initial tab: director starts on 'pending', others on 'mine'
  const [activeTab, setActiveTab] = useState<'mine' | 'pending' | 'all' | 'weekly_summary' | 'dept_approved' | 'history'>(
    canViewAll ? 'pending' : 'mine'
  );

  // Reset page when tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, statusFilter, filterDept, historySearch, historyTypeFilter, historyDeptFilter]);

  // Sync tab if user permissions change at runtime
  useEffect(() => {
    if (canViewAll && activeTab === 'mine') setActiveTab('pending');
  }, [canViewAll]);

  const myReports = useMemo(() => {
    if (!user) return [];
    const all = [...reports, ...revenueReports];
    return all
      .filter(r => r.authorId === user.id && getReportWeekInfo(r).start === currentWeekStartStr)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reports, revenueReports, user, currentWeekStartStr]);

  const pendingManagerReports = useMemo(() => {
    if (!canApprove || !user) return [];
    const all = [...reports, ...revenueReports];
    return all
      .filter(r => {
        // Department check – allow when either side is unset
        const deptOk = !r.department || !user.department || r.department === user.department;
        if (!deptOk) return false;
        if (r.authorId === user.id) return false;
        if (r.status !== 'Pending' && r.status !== 'Pending Manager') return false;
        // Revenue reports (have reportType) are not week-restricted
        if ('reportType' in r && r.reportType) return true;
        // Normal task reports – restrict to current week
        return getReportWeekInfo(r).start === currentWeekStartStr;
      })
      .sort((a, b) => new Date(b.submittedAt || b.createdAt).getTime() - new Date(a.submittedAt || a.createdAt).getTime());
  }, [reports, revenueReports, user, canApprove, currentWeekStartStr]);

  const deptApprovedReports = useMemo(() => {
    if (!canApprove || !user) return [];
    const all = [...reports, ...revenueReports];
    return all
      .filter(r => {
        const deptOk = !r.department || !user.department || r.department === user.department;
        if (!deptOk) return false;
        if (r.authorId === user.id) return false;
        if (r.status !== 'Approved' && r.status !== 'Pending Director') return false;
        if ('reportType' in r && r.reportType) return true;
        return getReportWeekInfo(r).start === currentWeekStartStr;
      })
      .sort((a, b) => new Date(b.approvedAt || b.createdAt).getTime() - new Date(a.approvedAt || a.createdAt).getTime());
  }, [reports, revenueReports, user, canApprove, currentWeekStartStr]);

  // List of roles that have manager capabilities
  const managerRoleNames = useMemo(() => {
    return new Set(
      roles
        .filter(r => Array.isArray(r.permissions) && (r.permissions.includes('approve_dept_reports') || r.permissions.includes('approve_dept_revenue') || r.permissions.includes('approve_all_revenue')))
        .map(r => r.name)
    );
  }, [roles]);

  // IDs of users who are department managers dynamically computed
  const managerIds = useMemo(
    () => new Set(users.filter(u => managerRoleNames.has(u.role)).map(u => u.id)),
    [users, managerRoleNames]
  );

  const pendingDirectorReports = useMemo(() => {
    if (!canViewAll) return [];
    const all = [...reports, ...revenueReports];
    return all
      .filter(r => {
        if (r.status === 'Pending Director') return getReportWeekInfo(r).start === currentWeekStartStr; // Revenue reports that reached Director
        if (r.status === 'Pending Manager' && canViewAll && user?.role === 'Admin') return getReportWeekInfo(r).start === currentWeekStartStr; // Admin can see all
        if (r.status === 'Pending' || r.status === 'Pending Manager') return managerIds.has(r.authorId) && getReportWeekInfo(r).start === currentWeekStartStr;
        return false;
      })
      .sort((a, b) => new Date(b.submittedAt || b.createdAt).getTime() - new Date(a.submittedAt || a.createdAt).getTime());
  }, [reports, revenueReports, canViewAll, managerIds, currentWeekStartStr]);

  const directorReports = useMemo(() => {
    if (!canViewAll) return [];
    // Director only sees Approved reports authored by department managers (Trưởng phòng)
    const all = [...reports, ...revenueReports];
    return all
      .filter(r => r.status === 'Approved' && managerIds.has(r.authorId) && getReportWeekInfo(r).start === currentWeekStartStr)
      .sort((a, b) => new Date(b.approvedAt || b.createdAt).getTime() - new Date(a.approvedAt || a.createdAt).getTime());
  }, [reports, revenueReports, canViewAll, managerIds, currentWeekStartStr]);

  const historyReports = useMemo(() => {
    if (!user) return [];
    let list: any[] = [];
    const all = [...reports, ...revenueReports];
    if (canViewAll) list = all;
    else if (canApprove) list = all.filter(r => r.department === user.department);
    else list = all.filter(r => r.authorId === user.id);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reports, revenueReports, user, canViewAll, canApprove]);

  // ── Early return AFTER all hooks ──
  if (!user) return null;

  const handleOpenCreate = () => { setSelectedReport(null); setIsModalOpen(true); };

  const [selectedRevenueReport, setSelectedRevenueReport] = useState<any>(null);

  const handleOpenView = (r: any) => {
    if (r.reportType) {
      setSelectedRevenueReport(r);
      setIsRevenueModalOpen(true);
    } else {
      setSelectedReport(r);
      setIsModalOpen(true);
    }
  };

  const getUserDetails = (id: string) => users.find(u => u.id === id);

  // ──────────────────────────────────────────────────────────────────────────
  // Auto-create/update consolidated dept report when manager approves an employee's report
  // ──────────────────────────────────────────────────────────────────────────
  const autoConsolidateForManager = async (approvedReport: Report) => {
    if (!user || !canApprove) return;

    let weekStart = '';
    let weekEnd = '';
    try {
      const c = JSON.parse(approvedReport.content);
      weekStart = c.weekStart || '';
      weekEnd = c.weekEnd || '';
    } catch { }
    if (!weekStart || !weekEnd) return;

    const fmtD = (iso: string) => {
      if (!iso) return '';
      const parts = iso.split('-');
      return `${parts[2]}/${parts[1]}`;
    };

    // Extract tasks from the newly approved report
    let newTasks: any[] = [];
    const authorName = users.find(u => u.id === approvedReport.authorId)?.name || 'Nhân viên';
    try {
      const c = JSON.parse(approvedReport.content);
      newTasks = (Array.isArray(c.tasks) ? c.tasks : [])
        .filter((t: any) => t.content?.trim())
        .map((t: any) => ({ ...t, id: Math.random().toString(36).slice(2), assignee: authorName }));
    } catch { }

    if (newTasks.length === 0) return;

    // Find existing consolidated report for this manager + week
    const existing = reports.find(r =>
      r.authorId === user.id &&
      r.department === user.department &&
      (() => {
        try { const c = JSON.parse(r.content); return c.weekStart === weekStart && c.weekEnd === weekEnd; }
        catch { return false; }
      })()
    );

    let prevTasks: any[] = [];
    let prevNextWeekPlan = '';
    if (existing) {
      try {
        const c = JSON.parse(existing.content);
        prevTasks = Array.isArray(c.tasks) ? c.tasks : [];
        prevNextWeekPlan = c.nextWeekPlan || '';
      } catch { }
    }

    // Combine tasks (append new ones to the bottom)
    const combinedTasks = [...prevTasks, ...newTasks];

    const consolidated: Report = {
      id: existing?.id || Math.random().toString(36).slice(2, 9),
      title: `Báo cáo tổng hợp phòng ${user.department} · Tuần ${fmtD(weekStart)}–${fmtD(weekEnd)}`,
      content: JSON.stringify({ tasks: combinedTasks, nextWeekPlan: prevNextWeekPlan, weekStart, weekEnd }),
      authorId: user.id,
      department: user.department,
      // Create as Draft, or keep existing status (e.g. if already sent to Director, it stays Pending)
      status: existing ? existing.status : 'Draft',
      createdAt: existing?.createdAt || new Date().toISOString(),
      submittedAt: existing?.submittedAt, // Keep existing submittedAt
      directorFeedback: existing?.directorFeedback,
      managerFeedback: existing?.managerFeedback,
    };

    await saveReport(consolidated);
  };

  const autoConsolidateRevenueForManager = async (approvedReport: any) => {
    if (!user || !canApprove) return;

    let newRows: any[] = [];
    const authorName = users.find(u => u.id === approvedReport.authorId)?.name || 'Nhân viên';
    try {
      const c = JSON.parse(approvedReport.content || '[]');
      newRows = (Array.isArray(c) ? c : []).map((t: any) => ({ ...t, assignee: authorName }));
    } catch { }

    if (newRows.length === 0) return;

    // Find existing consolidated report for this manager + period
    const existing = revenueReports.find(r =>
      r.authorId === user.id &&
      r.department === user.department &&
      r.reportType === approvedReport.reportType &&
      r.periodStart === approvedReport.periodStart &&
      r.periodEnd === approvedReport.periodEnd
    );

    let prevRows: any[] = [];
    if (existing) {
      try {
        const c = JSON.parse(existing.content || '[]');
        prevRows = Array.isArray(c) ? c : [];
      } catch { }
    }

    const combinedRows = [...prevRows, ...newRows];
    // sum totals
    const totalPreTax = combinedRows.reduce((sum, r) => sum + (Number(r.preTaxValue) || 0), 0);
    const totalDelivered = combinedRows.reduce((sum, r) => sum + (Number(r.deliveredMonth) || 0), 0);
    const totalCumulative = combinedRows.reduce((sum, r) => sum + (Number(r.deliveredCumulative) || 0), 0);

    const consolidated: any = {
      id: existing?.id || Math.random().toString(36).slice(2, 9),
      title: existing?.title || `Báo cáo doanh thu phòng ${user.department} · ${approvedReport.reportType === 'monthly' ? `Tháng ${new Date(approvedReport.periodStart || new Date()).getMonth()+1}/${new Date(approvedReport.periodStart || new Date()).getFullYear()}` : `Từ ${new Date(approvedReport.periodStart || new Date()).toLocaleDateString('vi-VN')}`}`,
      reportType: approvedReport.reportType,
      periodStart: approvedReport.periodStart,
      periodEnd: approvedReport.periodEnd,
      content: JSON.stringify(combinedRows),
      totalPreTax,
      totalDelivered,
      totalCumulative,
      authorId: user.id,
      department: user.department,
      status: existing ? existing.status : 'Draft',
      createdAt: existing?.createdAt || new Date().toISOString(),
      submittedAt: existing?.submittedAt,
      managerFeedback: existing?.managerFeedback,
      directorFeedback: existing?.directorFeedback,
    };

    // Need to use DataContext's saveRevenueReport. We'll get it from destructured values at the top.
    await saveRevenueReport(consolidated);
  };

  const RESULT_LABEL: Record<string, string> = { done: 'Đã hoàn thành', in_progress: 'Đang thực hiện', pending: 'Chưa thực hiện' };

  const exportExcel = () => {
    const rows: any[] = [];
    const source = activeTab === 'history' ? historyReports : displayedReports;
    source.forEach(r => {
      let tasks: any[] = [];
      try { const c = JSON.parse(r.content); tasks = Array.isArray(c.tasks) ? c.tasks : []; } catch { }
      const author = getUserDetails(r.authorId)?.name || r.authorId;
      const approver = r.approvedBy ? getUserDetails(r.approvedBy)?.name : '';
      const status = r.status === 'Approved' ? 'Đã duyệt' : r.status === 'Pending' ? 'Chờ duyệt' : r.status === 'Rejected' ? 'Từ chối' : 'Nháp';
      const weekLabel = getReportWeekInfo(r).label;
      if (tasks.length === 0) {
        rows.push({ 'Tuần': weekLabel, 'Tiêu đề': r.title, 'Phòng ban': r.department, 'Tác giả': author, 'Nội dung': '', 'Hợp đồng / Dự án': '', 'Kết quả': '', 'Bước tiếp theo': '', 'Ghi chú': '', 'Trạng thái': status, 'Người duyệt': approver });
      } else {
        tasks.forEach((t: any, i: number) => {
          let linkText = '';
          if (t.contractId) {
            const c = contracts?.find(x => x.id === t.contractId);
            if (c) linkText += `HĐ: ${c.contractNumber || c.contractName} (${t.contractStatus || '—'})`;
          }
          if (t.projectId) {
            const p = projects?.find(x => x.id === t.projectId);
            if (p) linkText += (linkText ? '\n' : '') + `DA: ${p.projectCode || p.name} (${t.projectStatus || '—'})`;
          }

          rows.push({
            'Tuần': i === 0 ? weekLabel : '',
            'Tiêu đề': i === 0 ? r.title : '',
            'Phòng ban': i === 0 ? r.department : '',
            'Tác giả': t.assignee || author,
            'Nội dung': t.content || '',
            'Hợp đồng / Dự án': linkText,
            'Kết quả': RESULT_LABEL[t.result] || '',
            'Bước tiếp theo': t.nextAction || '',
            'Ghi chú': t.note || '',
            'Trạng thái': i === 0 ? status : '',
            'Người duyệt': i === 0 ? approver : '',
          });
        });
      }
    });

    void exportXlsx(rows, `TranLe_BaoCao_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Báo cáo', [22, 35, 16, 16, 40, 30, 18, 30, 20, 12, 16]);
  };

  const pendingList = canViewAll ? pendingDirectorReports : pendingManagerReports;

  let displayedReports: any[] = [];
  if (activeTab === 'all' && canViewAll) displayedReports = directorReports;
  else if (activeTab === 'pending') displayedReports = pendingList;
  else if (activeTab === 'weekly_summary') displayedReports = [];
  else if (activeTab === 'dept_approved') displayedReports = deptApprovedReports;
  else displayedReports = myReports;

  // Apply department filter for director
  if (canViewAll && activeTab === 'all' && filterDept !== 'all') {
    displayedReports = displayedReports.filter(r => r.department === filterDept);
  }

  // Search & Filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    displayedReports = displayedReports.filter(r =>
      r.title.toLowerCase().includes(q) ||
      (getUserDetails(r.authorId)?.name || '').toLowerCase().includes(q)
    );
  }
  if (statusFilter !== 'all') {
    displayedReports = displayedReports.filter(r => r.status.toLowerCase().startsWith(statusFilter.toLowerCase()));
  }

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'Draft': return <span className="px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full flex items-center gap-1"><FileEdit size={12} /> Nháp</span>;
      case 'Pending': return <span className="px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full flex items-center gap-1"><Clock size={12} /> Chờ duyệt</span>;
      case 'Pending Manager': return <span className="px-2.5 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full flex items-center gap-1"><Clock size={12} /> Chờ TP duyệt</span>;
      case 'Pending Director': return <span className="px-2.5 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded-full flex items-center gap-1"><Clock size={12} /> Chờ GĐ duyệt</span>;
      case 'Approved': return <span className="px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full flex items-center gap-1"><CheckCircle size={12} /> Đã duyệt</span>;
      case 'Rejected': return <span className="px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full flex items-center gap-1"><XCircle size={12} /> Từ chối</span>;
      default: return null;
    }
  };

  const myStats = {
    total: myReports.length,
    pending: myReports.filter(r => r.status === 'Pending' || r.status === 'Pending Manager' || r.status === 'Pending Director').length,
    approved: myReports.filter(r => r.status === 'Approved').length,
    rejected: myReports.filter(r => r.status === 'Rejected').length,
  };

  const pieData = [
    { name: 'Đã duyệt', value: myStats.approved, color: '#10b981' },
    { name: 'Chờ duyệt', value: myStats.pending, color: '#f59e0b' },
    { name: 'Từ chối', value: myStats.rejected, color: '#ef4444' },
  ].filter(d => d.value > 0);

  const deptData = canViewAll ? departments.filter(d => !['GIÁM ĐỐC', 'ADMIN', 'Hội đồng quản trị và ban lãnh đạo công ty.'].includes(d.name)).map(dept => {
    return {
      name: dept.name,
      approved: reports.filter(r => r.department === dept.name && r.status === 'Approved').length,
      pending: reports.filter(r => r.department === dept.name && r.status === 'Pending').length,
    };
  }) : [];

  const currentWeekStart = useMemo(() => {
    return new Date(currentWeekStartStr + 'T00:00:00').getTime();
  }, [currentWeekStartStr]);

  // Progress bar data: how many employees submitted this week
  const submissionProgress = useMemo(() => {
    if (canViewAll || !canApprove || !user) return null;
    const myDept = user.department;
    const deptEmployees = users.filter(u => u.department === myDept && u.id !== user.id && !managerRoleNames.has(u.role) && u.role !== 'Admin');
    const submittedIds = new Set(
      reports.filter(r => r.department === myDept && r.authorId !== user.id && getReportWeekInfo(r).start === currentWeekStartStr).map(r => r.authorId)
    );
    return { total: deptEmployees.length, submitted: deptEmployees.filter(u => submittedIds.has(u.id)).length };
  }, [canViewAll, canApprove, user, users, reports, currentWeekStartStr, managerRoleNames]);

  // Countdown to Sunday 23:59 (deadline)
  const deadlineCountdown = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilSun = day === 0 ? 0 : 7 - day;
    const sun = new Date(now);
    sun.setDate(now.getDate() + daysUntilSun);
    sun.setHours(23, 59, 59, 999);
    const diff = sun.getTime() - now.getTime();
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return { days, hours, urgent: days === 0 };
  }, []);

  const unsubmittedEmployees = useMemo(() => {
    if (canViewAll || !canApprove) return [];
    if (!user) return [];
    const myDept = user.department;
    const deptUsers = users.filter(u => u.department === myDept && u.role !== 'Admin');
    const submittedIds = new Set(
      reports.filter(r => r.department === myDept && new Date(r.createdAt).getTime() >= currentWeekStart).map(r => r.authorId)
    );
    return deptUsers.filter(u => !submittedIds.has(u.id));
  }, [canViewAll, canApprove, user, users, reports, currentWeekStart]);

  const unsubmittedDepts = useMemo(() => {
    if (!canViewAll) return [];
    const activeDepts = departments.filter(d => !['GIÁM ĐỐC', 'ADMIN', 'Hội đồng quản trị và ban lãnh đạo công ty.'].includes(d.name)).map(d => d.name);
    const submittedDepts = new Set(
      reports.filter(r => new Date(r.createdAt).getTime() >= currentWeekStart).map(r => r.department)
    );
    return activeDepts.filter(d => !submittedDepts.has(d));
  }, [canViewAll, departments, reports, currentWeekStart]);

  // ── Logic: Chỉ báo cáo vào T6, T7, CN và mỗi tuần 1 lần ──
  const isReportDay = [0, 5, 6].includes(new Date().getDay());



  const hasReportedThisWeek = useMemo(() => {
    return myReports.some(r => {
      if ('reportType' in r && r.reportType) return false; // Ignore revenue reports for this check
      try {
        const c = JSON.parse(r.content || '{}');
        return c.weekStart === currentWeekStartStr;
      } catch {
        return false;
      }
    });
  }, [myReports, currentWeekStartStr]);

  const canCreateNewReport = devMode || (isReportDay && !hasReportedThisWeek);

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Quản lý Báo cáo</h2>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-gray-500 text-sm">Gửi, theo dõi và xuất báo cáo công việc hàng tuần</p>
            {!canViewAll && deadlineCountdown && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${deadlineCountdown.urgent ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-amber-50 text-amber-700'}`}>
                <Timer size={12} />
                {deadlineCountdown.urgent ? `Còn ${deadlineCountdown.hours}h` : `Còn ${deadlineCountdown.days} ngày ${deadlineCountdown.hours}h`} để nộp
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setDevMode(!devMode)} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-colors shadow-sm border ${devMode ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            Dev Mode {devMode ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setShowAnalytics(!showAnalytics)} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-colors shadow-sm border ${showAnalytics ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            <PieChart size={16} /> Thống kê
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors shadow-sm no-print">
            <Printer size={16} /> Xuất PDF
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-white border border-green-200 rounded-xl hover:bg-green-50 transition-colors shadow-sm no-print">
            <Download size={16} /> Xuất Excel
          </button>
          {(perms.includes('create_revenue_report') || perms.includes('approve_dept_revenue') || perms.includes('approve_all_revenue') || user?.role?.toLowerCase() === 'admin') && (
            <button onClick={() => { setSelectedRevenueReport(null); setIsRevenueModalOpen(true); }} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 transition-colors shadow-sm">
              <DollarSign size={16} /> Báo cáo Doanh thu
            </button>
          )}
          {(canCreate || canApprove) && !canViewAll && (
            <div className="relative group">
              <button
                onClick={handleOpenCreate}
                disabled={!canCreateNewReport}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-colors shadow-sm ${canCreateNewReport ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed opacity-80'}`}
              >
                <PlusCircle size={16} />
                {canApprove ? 'Tạo báo cáo tổng hợp phòng' : 'Tạo báo cáo tuần này'}
              </button>
              {!canCreateNewReport && (
                <div className="absolute top-full mt-2 right-0 w-64 p-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg text-center">
                  {!isReportDay ? 'Hệ thống chỉ mở tính năng báo cáo vào Thứ 6, Thứ 7 và Chủ nhật.' : 'Bạn đã có báo cáo trong tuần này rồi.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* STATS CARDS (non-director) */}
      {!canViewAll && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Tổng báo cáo', value: myStats.total, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', icon: <FileText size={22} /> },
              { label: 'Chờ duyệt', value: myStats.pending, bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-100', icon: <Clock size={22} /> },
              { label: 'Đã duyệt', value: myStats.approved, bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-100', icon: <CheckCircle size={22} /> },
              { label: 'Từ chối', value: myStats.rejected, bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100', icon: <XCircle size={22} /> },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl border ${s.bg} ${s.border} p-4 flex items-center gap-3`}>
                <div className={`${s.text} opacity-80`}>{s.icon}</div>
                <div>
                  <p className={`text-2xl font-bold ${s.text}`}>{s.value}</p>
                  <p className="text-xs font-medium text-gray-500 mt-0.5">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
          {/* PROGRESS BAR for manager */}
          {canApprove && submissionProgress && submissionProgress.total > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Users size={16} className="text-blue-500" /> Tiến trình nộp báo cáo tuần này
                </span>
                <span className={`text-sm font-bold ${submissionProgress.submitted === submissionProgress.total ? 'text-green-600' : 'text-amber-600'}`}>
                  {submissionProgress.submitted}/{submissionProgress.total} nhân viên
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${submissionProgress.submitted === submissionProgress.total ? 'bg-gradient-to-r from-green-400 to-green-500' : 'bg-gradient-to-r from-blue-400 to-blue-500'}`}
                  style={{ width: `${Math.round((submissionProgress.submitted / submissionProgress.total) * 100)}%` }}
                />
              </div>
              {submissionProgress.submitted === submissionProgress.total && (
                <p className="text-xs text-green-600 font-medium mt-1.5 flex items-center gap-1"><CheckCircle size={12} /> Tất cả nhân viên đã nộp báo cáo!</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ANALYTICS DASHBOARD */}
      {showAnalytics && (
        <div className={`grid grid-cols-1 ${canViewAll ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-4 animate-in fade-in slide-in-from-top-4 duration-300`}>
          {!canViewAll ? (
            <>
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><PieChart size={16} /> Tỷ lệ trạng thái báo cáo</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <RePieChart>
                      <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                        {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                      </Pie>
                      <ReTooltip />
                      <Legend verticalAlign="bottom" height={36} />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {canApprove && (
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col h-full max-h-[330px]">
                  <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><Clock size={16} className="text-amber-500" /> Chưa nộp báo cáo tuần này</h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                    {unsubmittedEmployees.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400 py-6">
                        <CheckCircle size={32} className="text-green-400 mb-2 opacity-50" />
                        <span className="text-sm font-medium">Tất cả nhân viên đã nộp</span>
                      </div>
                    ) : (
                      unsubmittedEmployees.map(u => (
                        <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-red-100 bg-red-50/50 hover:bg-red-50 transition-colors">
                          <Avatar src={u.avatar} alt={u.name} size={8} />
                          <div>
                            <p className="text-sm font-bold text-gray-800">{u.name}</p>
                            <p className="text-xs text-red-500 font-medium">Chưa nộp</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm lg:col-span-2">
                <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><BarChart size={16} /> Thống kê theo phòng ban</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <ReBarChart data={deptData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <ReTooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend />
                      <Bar dataKey="approved" name="Đã duyệt" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                      <Bar dataKey="pending" name="Chờ duyệt" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </ReBarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col h-full max-h-[360px]">
                <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><Building2 size={16} className="text-amber-500" /> Phòng ban chưa nộp tuần này</h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                  {unsubmittedDepts.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 py-6">
                      <CheckCircle size={32} className="text-green-400 mb-2 opacity-50" />
                      <span className="text-sm font-medium">Tất cả phòng ban đã nộp</span>
                    </div>
                  ) : (
                    unsubmittedDepts.map(d => (
                      <div key={d} className="flex items-center gap-3 p-3 rounded-xl border border-red-100 bg-red-50/50 hover:bg-red-50 transition-colors">
                        <div className="p-2 bg-white text-red-500 rounded-lg shadow-sm border border-red-100">
                          <Building2 size={16} />
                        </div>
                        <p className="text-sm font-bold text-gray-800 flex-1">{d}</p>
                        <span className="text-[10px] font-bold text-red-500 bg-white px-2 py-1 rounded shadow-sm border border-red-100">Thiếu</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TABS */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {!canViewAll && (
          <button
            className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'mine' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('mine')}
          >
            <FileText size={15} /> Báo cáo của tôi
            <span className="bg-gray-100 text-gray-600 text-[11px] px-1.5 py-0.5 rounded-full">{myStats.total}</span>
          </button>
        )}
        {!canViewAll && canApprove && (
          <>
            <button
              className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'pending' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('pending')}
            >
              <Clock size={15} /> Cần duyệt
              {pendingList.length > 0 && <span className="bg-red-500 text-white text-[11px] px-1.5 py-0.5 rounded-full animate-pulse">{pendingList.length}</span>}
            </button>
            <button
              className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'dept_approved' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              onClick={() => setActiveTab('dept_approved')}
            >
              <CheckCircle size={15} /> Đã duyệt
              {deptApprovedReports.length > 0 && <span className="bg-green-100 text-green-700 text-[11px] px-1.5 py-0.5 rounded-full">{deptApprovedReports.length}</span>}
            </button>
          </>
        )}
        {canViewAll && (
          <>
            <button className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'pending' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('pending')}>
              <Clock size={15} /> Chưa duyệt
              {pendingDirectorReports.length > 0 && <span className="bg-red-500 text-white text-[11px] px-1.5 py-0.5 rounded-full animate-pulse">{pendingDirectorReports.length}</span>}
            </button>
            <button className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('all')}>
              <CheckCircle size={15} /> Đã duyệt
              {directorReports.length > 0 && <span className="bg-green-100 text-green-700 text-[11px] px-1.5 py-0.5 rounded-full">{directorReports.length}</span>}
            </button>
            <button className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'weekly_summary' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('weekly_summary')}>
              <CalendarDays size={15} /> Tổng hợp tuần
            </button>
          </>
        )}
        <button
          className={`py-3 px-5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={15} /> Lịch sử
        </button>
      </div>

      {/* SEARCH & FILTERS */}
      {activeTab !== 'weekly_summary' && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 my-4">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            {activeTab === 'history' ? (
              <input
                type="text"
                placeholder="Tìm kiếm lịch sử..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-gray-50/50 hover:bg-white focus:bg-white"
              />
            ) : (
              <input
                type="text"
                placeholder="Tìm kiếm báo cáo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow bg-gray-50/50 hover:bg-white focus:bg-white"
              />
            )}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 font-medium">
            {activeTab === 'history' ? (
              <>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Filter size={16} className="text-gray-400" />
                  <select value={historyTypeFilter} onChange={e => setHistoryTypeFilter(e.target.value as any)} className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-white focus:bg-white outline-none font-medium text-gray-700">
                    <option value="all">Tất cả loại báo cáo</option>
                    <option value="task">Báo cáo công việc</option>
                    <option value="revenue">Báo cáo doanh thu</option>
                  </select>
                </div>
                {(canViewAll || canApprove) && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Building2 size={16} className="text-gray-400" />
                    <select value={historyDeptFilter} onChange={e => setHistoryDeptFilter(e.target.value)} className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-white focus:bg-white outline-none font-medium text-gray-700">
                      <option value="all">Tất cả phòng ban</option>
                      {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <>
                {canViewAll && activeTab === 'all' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Filter size={16} className="text-gray-400" />
                    <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-white focus:bg-white outline-none">
                      <option value="all">Tất cả phòng ban</option>
                      {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm px-3 py-2 border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-white focus:bg-white outline-none">
                    <option value="all">Tất cả trạng thái</option>
                    <option value="pending">Chờ duyệt</option>
                    <option value="approved">Đã duyệt</option>
                    <option value="rejected">Từ chối</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* WEEKLY SUMMARY */}
      {activeTab === 'weekly_summary' && canViewAll ? (
        <div className="space-y-5">
          {Object.entries(
            [...directorReports, ...pendingDirectorReports].reduce((acc, r) => {
              let k = 'Tuần không xác định';
              try { const c = JSON.parse(r.content || '{}'); if (c.weekStart && c.weekEnd) k = `Tuần ${c.weekStart} – ${c.weekEnd}`; } catch { }
              if (!acc[k]) acc[k] = []; acc[k].push(r); return acc;
            }, {} as Record<string, any[]>)
          ).sort((a, b) => b[0].localeCompare(a[0])).map(([week, rpts]) => (
            <div key={week} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-3 border-b border-blue-100 flex items-center justify-between">
                <h3 className="font-bold text-blue-800 flex items-center gap-2"><CalendarDays size={16} />{week}</h3>
                <span className="text-xs font-medium text-blue-600 bg-white px-2.5 py-1 rounded-full border border-blue-200">{rpts.length} phòng</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
                {departments.filter(d => !['GIÁM ĐỐC', 'ADMIN', 'Hội đồng quản trị và ban lãnh đạo công ty.'].includes(d.name)).map(dept => {
                  const rpt = rpts.find(r => r.department === dept.name);
                  return (
                    <div key={dept.id} onClick={() => rpt && handleOpenView(rpt)}
                      className={`p-4 rounded-xl border-2 transition-all ${rpt ? 'border-green-200 bg-green-50/40 hover:bg-green-50 cursor-pointer shadow-sm hover:shadow' : 'border-dashed border-gray-200 bg-gray-50/50'}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${rpt ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}><Building2 size={18} /></div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`font-semibold text-sm ${rpt ? 'text-gray-800' : 'text-gray-400'}`}>{dept.name}</h4>
                          {rpt && <div className="mt-0.5">{renderStatusBadge(rpt.status)}</div>}
                        </div>
                      </div>
                      {rpt ? <p className="text-xs text-gray-500 line-clamp-2">{rpt.title}</p> : <p className="text-xs text-gray-400 flex items-center gap-1"><XCircle size={12} />Chưa nộp</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {directorReports.length === 0 && pendingDirectorReports.length === 0 && (
            <div className="py-16 text-center text-gray-400 bg-white rounded-2xl border border-gray-200">
              <FileText size={40} className="mx-auto mb-3 opacity-20" /><p className="font-medium">Không có dữ liệu tổng hợp</p>
            </div>
          )}
        </div>
      ) : activeTab === 'history' ? (() => {
        const hq = historySearch.toLowerCase();
        let filteredHistory = historyReports;

        // 1. Search Filter
        if (hq) {
          filteredHistory = filteredHistory.filter(r => 
            r.title.toLowerCase().includes(hq) || 
            (getUserDetails(r.authorId)?.name || '').toLowerCase().includes(hq) || 
            (r.department || '').toLowerCase().includes(hq)
          );
        }

        // 2. Type Filter
        if (historyTypeFilter === 'task') {
          filteredHistory = filteredHistory.filter(r => !r.reportType);
        } else if (historyTypeFilter === 'revenue') {
          filteredHistory = filteredHistory.filter(r => !!r.reportType);
        }

        // 3. Dept Filter
        if (historyDeptFilter !== 'all') {
          filteredHistory = filteredHistory.filter(r => r.department === historyDeptFilter);
        }

        // Group by week
        const weekGroups = Object.entries(
          filteredHistory.reduce((acc, r) => {
            const week = getReportWeekInfo(r).label;
            if (!acc[week]) acc[week] = [];
            acc[week].push(r);
            return acc;
          }, {} as Record<string, any[]>)
        ).sort((a, b) => b[0].localeCompare(a[0]));

        const totalWeeks = weekGroups.length;
        const visibleWeeks = weekGroups.slice(0, historyWeeksShown);
        const hasMore = historyWeeksShown < totalWeeks;

        // Week comparison data (all weeks, max 8 for chart)
        const comparisonData = weekGroups.slice(0, 8).reverse().map((entry) => {
          const week = entry[0];
          const rpts = entry[1] as any[];
          const shortLabel = week.startsWith('Tháng') ? week.replace('Tháng ', 'T') : week.replace('Tuần ', '').split(' – ')[0];
          const done = rpts.filter(r => r.status === 'Approved').length;
          const pending = rpts.filter(r => r.status === 'Pending' || r.status === 'Pending Manager' || r.status === 'Pending Director').length;
          return { week: shortLabel, total: rpts.length, done, pending };
        });
        const maxTotal = Math.max(...comparisonData.map(d => d.total), 1);

        return (
          <div className="space-y-6">
            {/* WEEK COMPARISON CHART */}
            {comparisonData.length >= 2 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <BarChart size={16} className="text-blue-500" /> So sánh theo tuần/tháng
                </h3>
                <div className="flex items-end gap-2 h-28">
                  {comparisonData.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                      <div className="relative w-full flex flex-col items-center" style={{ height: '80px' }}>
                        {/* Bar */}
                        <div className="w-full max-w-[40px] rounded-t-lg overflow-hidden flex flex-col justify-end absolute bottom-0" style={{ height: `${Math.max((d.total / maxTotal) * 100, 8)}%` }}>
                          <div className="bg-green-400 transition-all duration-500" style={{ height: d.total > 0 ? `${(d.done / d.total) * 100}%` : '0%' }} />
                          <div className="bg-amber-400 transition-all duration-500" style={{ height: d.total > 0 ? `${(d.pending / d.total) * 100}%` : '0%' }} />
                          <div className="bg-gray-200 flex-1" />
                        </div>
                        {/* Tooltip */}
                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                          {d.total} báo cáo ({d.done} duyệt)
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 font-medium truncate w-full text-center">{d.week}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-4 mt-3 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-400" />Đã duyệt</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Chờ duyệt</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200" />Khác</span>
                </div>
              </div>
            )}

            {/* WEEK GROUPS */}
            {visibleWeeks.map((entry) => {
              const week = entry[0];
              const rpts = entry[1] as any[];
              return (
                <div key={week} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-gray-700 flex items-center gap-2"><CalendarDays size={16} />{week}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{rpts.filter(r => r.status === 'Approved').length} duyệt</span>
                      <span className="text-xs font-medium text-gray-500 bg-white px-2.5 py-1 rounded-full border border-gray-200">{rpts.length} báo cáo</span>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {rpts.map((report: any) => {
                      const author = getUserDetails(report.authorId);
                      let approver = report.approvedBy ? getUserDetails(report.approvedBy) : null;
                      if (!approver && report.status?.startsWith('Pending')) { const dept = departments.find(d => d.name === report.department); if (dept?.managerId) approver = getUserDetails(dept.managerId); }
                      const lColor = report.status === 'Approved' ? 'border-l-green-400' : report.status?.startsWith('Pending') ? 'border-l-yellow-400' : report.status === 'Rejected' ? 'border-l-red-400' : 'border-l-gray-200';
                      const iColor = report.status === 'Approved' ? 'bg-green-100 text-green-600' : report.status?.startsWith('Pending') ? 'bg-yellow-100 text-yellow-600' : report.status === 'Rejected' ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-400';
                      const d = new Date(report.approvedAt || report.submittedAt || report.createdAt);
                      return (
                        <div key={report.id} onClick={() => handleOpenView(report)}
                          className={`px-5 py-4 grid grid-cols-12 gap-3 items-center hover:bg-blue-50/40 transition-colors cursor-pointer group border-l-4 ${lColor}`}>
                          <div className="col-span-6 md:col-span-5 flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${iColor}`}>
                              {report.reportType ? <DollarSign size={18} /> : <FileText size={18} />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-800 truncate text-sm group-hover:text-blue-600 transition-colors">{report.title}</p>
                              {(canViewAll || canApprove) && author && (
                                <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                                  <Avatar src={author.avatar} alt={author.name} size={4} />{author.name}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="col-span-3 hidden md:flex items-center justify-center">
                            {approver ? (<div className="flex items-center gap-2"><Avatar src={approver.avatar} alt={approver.name} size={6} /><span className="truncate max-w-[90px] text-xs text-gray-600">{approver.name}</span></div>) : <span className="text-gray-300">—</span>}
                          </div>
                          <div className="col-span-2 flex justify-center">{renderStatusBadge(report.status)}</div>
                          <div className="col-span-6 md:col-span-2 flex items-center justify-end gap-2">
                            <div className="text-right">
                              <p className="text-xs font-medium text-gray-700">{d.toLocaleDateString('vi-VN')}</p>
                              <p className="text-[11px] text-gray-400">{d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* LOAD MORE */}
            {hasMore && (
              <div className="text-center">
                <button onClick={() => setHistoryWeeksShown(prev => prev + 4)}
                  className="px-6 py-2.5 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors border border-blue-200 shadow-sm">
                  Xem thêm ({totalWeeks - historyWeeksShown} tuần còn lại)
                </button>
              </div>
            )}

            {filteredHistory.length === 0 && (
              <div className="py-16 text-center text-gray-400 bg-white rounded-2xl border border-gray-200">
                <History size={44} className="mx-auto mb-3 opacity-20" />
                <p className="font-medium text-gray-500">Không có lịch sử báo cáo nào</p>
              </div>
            )}
          </div>
        );
      })() : (
        /* REPORT LIST */
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-gray-50 px-5 py-3 border-b border-gray-100 grid grid-cols-12 gap-3 text-xs font-bold text-gray-400 uppercase tracking-wider">
            <div className="col-span-6 md:col-span-5">Báo cáo</div>
            <div className="col-span-3 hidden md:block text-center">Người duyệt</div>
            <div className="col-span-2 text-center">Trạng thái</div>
            <div className="col-span-6 md:col-span-2 text-right">Ngày</div>
          </div>
          <div className="divide-y divide-gray-100">
            {displayedReports.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <FileText size={44} className="mx-auto mb-3 opacity-20" />
                <p className="font-medium text-gray-500">Không có báo cáo nào</p>
                <p className="text-sm mt-1 text-gray-400">{activeTab === 'pending' ? 'Tất cả báo cáo đã được xử lý ✓' : 'Nhấn nút tạo báo cáo để bắt đầu'}</p>
              </div>
            ) : (() => {
              const totalItems = displayedReports.length;
              const totalPages = Math.ceil(totalItems / itemsPerPage);
              const currentData = displayedReports.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
              return (
                <>
                  {currentData.map(report => {
              const author = getUserDetails(report.authorId);
              let approver = report.approvedBy ? getUserDetails(report.approvedBy) : null;
              if (!approver && report.status?.startsWith('Pending')) { const dept = departments.find(d => d.name === report.department); if (dept?.managerId) approver = getUserDetails(dept.managerId); }
              const lColor = report.status === 'Approved' ? 'border-l-green-400' : report.status?.startsWith('Pending') ? 'border-l-yellow-400' : report.status === 'Rejected' ? 'border-l-red-400' : 'border-l-gray-200';
              const iColor = report.status === 'Approved' ? 'bg-green-100 text-green-600' : report.status?.startsWith('Pending') ? 'bg-yellow-100 text-yellow-600' : report.status === 'Rejected' ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-400';
              const d = new Date(report.approvedAt || report.submittedAt || report.createdAt);
              return (
                <div key={report.id} onClick={() => handleOpenView(report)}
                  className={`px-5 py-4 grid grid-cols-12 gap-3 items-center hover:bg-blue-50/40 transition-colors cursor-pointer group border-l-4 ${lColor}`}>
                  <div className="col-span-6 md:col-span-5 flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${iColor}`}>
                      {report.reportType ? <DollarSign size={18} /> : <FileText size={18} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate text-sm group-hover:text-blue-600 transition-colors">{report.title}</p>
                      {(canViewAll || canApprove) && author && (
                        <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                          <Avatar src={author.avatar} alt={author.name} size={4} />{author.name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="col-span-3 hidden md:flex items-center justify-center">
                    {approver ? (<div className="flex items-center gap-2"><Avatar src={approver.avatar} alt={approver.name} size={6} /><span className="truncate max-w-[90px] text-xs text-gray-600">{approver.name}</span></div>) : <span className="text-gray-300">—</span>}
                  </div>
                  <div className="col-span-2 flex justify-center">{renderStatusBadge(report.status)}</div>
                  <div className="col-span-6 md:col-span-2 flex items-center justify-end gap-2">
                    <div className="text-right">
                      <p className="text-xs font-medium text-gray-700">{d.toLocaleDateString('vi-VN')}</p>
                      <p className="text-[11px] text-gray-400">{d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    {report.authorId === user.id && ['Draft', 'Rejected'].includes(report.status) && (
                      <button onClick={e => { e.stopPropagation(); setDeleteConfirmId(report.id); }} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {totalPages > 1 && (
              <div className="p-4 border-t border-gray-100 bg-gray-50/50">
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={totalItems} itemsPerPage={itemsPerPage} />
              </div>
            )}
            </>
            );
            })()}
          </div>
        </div>
      )}

      <ReportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={async (r) => {
          await saveReport(r);

          if (!selectedReport) {
            showToast({ type: 'success', title: 'Thêm báo cáo thành công' });
            if (user) {
              pushLocalNotification({
                userId: user.id,
                type: 'report_created',
                title: '✅ Thêm báo cáo thành công',
                message: `Báo cáo "${r.title}" đã được tạo.`
              });
            }
          } else {
            showToast({ type: 'success', title: 'Cập nhật báo cáo thành công' });
            if (user) {
              pushLocalNotification({
                userId: user.id,
                type: 'report_updated',
                title: '🔄 Cập nhật báo cáo thành công',
                message: `Báo cáo "${r.title}" đã được cập nhật.`
              });
            }
          }

          // If manager just approved an employee's report: auto-create/update consolidated dept report
          if (
            r.status === 'Approved' &&
            canApprove &&
            r.authorId !== user?.id &&
            r.department === user?.department
          ) {
            await autoConsolidateForManager(r);
          }

          // Refresh notifications so badge updates immediately
          setTimeout(refreshNotifications, 800);
        }}
        onDelete={(id) => {
          const rpt = reports.find(r => r.id === id);
          deleteReport(id);
          setIsModalOpen(false);
          if (rpt && user) {
            showToast({ type: 'success', title: 'Đã xóa báo cáo thành công' });
            pushLocalNotification({
              userId: user.id,
              type: 'report_deleted',
              title: '🗑️ Báo cáo đã bị xóa',
              message: `Báo cáo "${rpt.title}" đã được xóa khỏi hệ thống.`
            });
          }
        }}
        onAdminHardDelete={(id) => {
          const rpt = reports.find(r => r.id === id);
          adminHardDeleteReport(id);
          setIsModalOpen(false);
          if (rpt && user) {
            showToast({ type: 'success', title: 'Đã xóa vĩnh viễn báo cáo' });
            pushLocalNotification({
              userId: user.id,
              type: 'report_deleted',
              title: '🗑️ Xóa vĩnh viễn báo cáo',
              message: `Báo cáo "${rpt.title}" đã bị xóa vĩnh viễn bởi Admin.`
            });
          }
        }}
        initialReport={selectedReport}
        currentUser={user}
        tasks={tasks}
        departments={departments}
        users={users}
        allReports={reports}
        contracts={contracts || []}
        projects={projects || []}
        saveContract={saveContract}
        saveProject={saveProject}
        t={t}
      />

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="Xóa báo cáo"
        message="Bạn có chắc chắn muốn xóa báo cáo này? Thao tác này không thể hoàn tác."
        confirmText="Xóa"
        cancelText="Hủy"
        type="danger"
        onConfirm={() => {
          if (deleteConfirmId) {
            const rpt = reports.find(r => r.id === deleteConfirmId);
            deleteReport(deleteConfirmId);
            setDeleteConfirmId(null);
            if (rpt && user) {
              showToast({ type: 'success', title: 'Đã xóa báo cáo thành công' });
              pushLocalNotification({
                userId: user.id,
                type: 'report_deleted',
                title: '🗑️ Báo cáo đã bị xóa',
                message: `Báo cáo "${rpt.title}" đã được xóa khỏi hệ thống.`
              });
            }
          }
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <RevenueReportModal 
        isOpen={isRevenueModalOpen} 
        onClose={() => { setIsRevenueModalOpen(false); setSelectedRevenueReport(null); }} 
        report={selectedRevenueReport} 
        onSave={async (r) => {
          if (!selectedRevenueReport) {
            showToast({ type: 'success', title: 'Thêm báo cáo doanh thu thành công' });
            if (user) {
              pushLocalNotification({
                userId: user.id,
                type: 'report_created',
                title: '✅ Thêm báo cáo doanh thu',
                message: `Báo cáo "${r.title}" đã được tạo.`
              });
            }
          } else {
            showToast({ type: 'success', title: 'Cập nhật báo cáo doanh thu thành công' });
            if (user) {
              pushLocalNotification({
                userId: user.id,
                type: 'report_updated',
                title: '🔄 Cập nhật doanh thu',
                message: `Báo cáo "${r.title}" đã được cập nhật.`
              });
            }
          }

          if (
            r.status === 'Approved' &&
            canApprove &&
            r.authorId !== user?.id &&
            r.department === user?.department
          ) {
            await autoConsolidateRevenueForManager(r);
          }
          setTimeout(refreshNotifications, 800);
        }}
      />
    </div>
  );
}
