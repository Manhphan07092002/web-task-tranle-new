import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, ClipboardCheck, Download, FileText, TriangleAlert, Upload } from 'lucide-react';
import { useRBAC } from '../../../hooks/useRBAC';
import { getMeetings } from '../../../services/meetingService';
import {
  getDashboard,
  type WarehouseDashboardData,
  type WarehouseTransaction,
} from '../../../services/warehouseService';
import type { Meeting } from '../../../types';
import { WarehouseDashboardHeader } from './WarehouseDashboardHeader';
import { WarehouseKpiGrid, type WarehouseKpiItem } from './WarehouseKpiGrid';
import { WarehouseTaskTable } from './WarehouseTaskTable';
import { WarehouseScheduleTimeline, type ScheduleItem } from './WarehouseScheduleTimeline';
import { WarehouseInventoryAlertChart } from './WarehouseInventoryAlertChart';
import { WarehouseDocumentTypeChart } from './WarehouseDocumentTypeChart';
import { WarehouseApprovalList } from './WarehouseApprovalList';
import { WarehouseRecentMessages } from './WarehouseRecentMessages';
import { WarehouseUpcomingMeetings } from './WarehouseUpcomingMeetings';
import { WarehouseNotificationList } from './WarehouseNotificationList';
import { deltaText, formatTime } from './warehouseLabels';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const todayLabel = () => {
  const now = new Date();
  const weekday = now.toLocaleDateString('vi-VN', { weekday: 'long' });
  const date = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${date}`;
};

export default function WarehouseDashboardPage() {
  const navigate = useNavigate();
  const rbac = useRBAC();
  const [data, setData] = useState<WarehouseDashboardData | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [top, setTop] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const dashboard = await getDashboard({ top, month });
      setData(dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dashboard kho.');
    } finally {
      setLoading(false);
    }
  }, [top, month]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getMeetings();
        if (!cancelled) setMeetings(Array.isArray(all) ? all : []);
      } catch {
        if (!cancelled) setMeetings([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isManager = rbac.isManager;

  const kpis: WarehouseKpiItem[] = useMemo(() => {
    if (!data) return [];
    const k = data.kpis;
    if (!isManager) {
      const mine = data.myTasks;
      const byType = (t: string) => mine.filter((m) => m.type === t).length;
      const myPending = mine.filter((m) => m.status === 'pending').length;
      return [
        { label: 'Phiếu cần xử lý', value: myPending, icon: FileText, color: 'from-blue-500 to-blue-400', subtitle: 'phiếu của tôi chờ xử lý', alert: myPending > 0 },
        { label: 'Nhập kho được giao', value: byType('IN'), icon: Download, color: 'from-emerald-500 to-emerald-400', subtitle: 'phiếu nhập của tôi' },
        { label: 'Xuất kho được giao', value: byType('OUT'), icon: Upload, color: 'from-rose-500 to-rose-400', subtitle: 'phiếu xuất của tôi' },
        { label: 'Điều chuyển được giao', value: byType('TRANSFER'), icon: ArrowLeftRight, color: 'from-orange-500 to-orange-400', subtitle: 'phiếu điều chuyển của tôi' },
        { label: 'Kiểm kê được giao', value: byType('ADJUST'), icon: ClipboardCheck, color: 'from-purple-500 to-purple-400', subtitle: 'phiếu kiểm kê của tôi' },
        { label: 'Cảnh báo liên quan', value: k.inventoryAlerts, icon: TriangleAlert, color: 'from-amber-500 to-amber-400', subtitle: 'mặt hàng dưới mức tối thiểu', alert: k.inventoryAlerts > 0 },
      ];
    }
    return [
      { label: 'Phiếu cần xử lý', value: k.pendingDocuments, icon: FileText, color: 'from-blue-500 to-blue-400', subtitle: deltaText(k.pendingDeltaPct, 'so với tuần trước') || 'phiếu chờ trong phạm vi', alert: k.pendingDocuments > 0 },
      { label: 'Nhập kho hôm nay', value: k.receiptsToday, icon: Download, color: 'from-emerald-500 to-emerald-400', subtitle: deltaText(k.receiptsDeltaPct, 'so với hôm qua') || 'phiếu nhập hôm nay' },
      { label: 'Xuất kho hôm nay', value: k.issuesToday, icon: Upload, color: 'from-rose-500 to-rose-400', subtitle: deltaText(k.issuesDeltaPct, 'so với hôm qua') || 'phiếu xuất hôm nay' },
      { label: 'Điều chuyển đang xử lý', value: k.transfersInProgress, icon: ArrowLeftRight, color: 'from-orange-500 to-orange-400', subtitle: 'phiếu điều chuyển chờ' },
      { label: 'Kiểm kê chờ duyệt', value: k.pendingStockCounts, icon: ClipboardCheck, color: 'from-purple-500 to-purple-400', subtitle: 'phiếu kiểm kê chờ' },
      { label: 'Cảnh báo tồn', value: k.inventoryAlerts, icon: TriangleAlert, color: 'from-amber-500 to-amber-400', subtitle: 'mặt hàng dưới mức tối thiểu', alert: k.inventoryAlerts > 0 },
    ];
  }, [data, isManager]);

  const scheduleItems: ScheduleItem[] = useMemo(() => {
    const tasks: WarehouseTransaction[] = data ? (isManager ? data.teamActivity : data.myTasks) : [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const items: ScheduleItem[] = tasks
      .filter((t) => t.dueDate && t.dueDate.slice(0, 10) === todayStr)
      .map((t) => ({
        id: `tx-${t.id}`,
        time: formatTime(t.dueDate),
        title: `${t.productName}`,
        code: t.transactionCode,
        detail: t.productName,
        location: t.toLocation || t.fromLocation,
        type: t.type,
        to: '/warehouse',
      }));
    meetings
      .filter((m) => m.startTime && m.startTime.slice(0, 10) === todayStr && m.status !== 'cancelled')
      .forEach((m) => items.push({
        id: `mt-${m.id}`,
        time: formatTime(m.startTime),
        title: m.title,
        detail: `${formatTime(m.startTime)} - ${formatTime(m.endTime)}`,
        location: 'Họp',
        to: '/meetings',
      }));
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [data, isManager, meetings]);

  const monthLabel = `tháng ${month.slice(5)}/${month.slice(0, 4)}`;

  if (loading && !data) {
    return <div className="max-w-7xl mx-auto p-8 text-center text-gray-400">Đang tải dashboard kho...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <WarehouseDashboardHeader
        title={isManager ? 'Dashboard Trưởng phòng Kho vận' : 'Dashboard Nhân viên Kho vận'}
        subtitle={isManager
          ? 'Tổng quan hoạt động kho vận, tình hình xuất nhập tồn, hiệu suất đội ngũ và các vấn đề cần xử lý.'
          : 'Mở lên là thấy ngay hôm nay mình phải làm gì: phiếu được giao, lịch làm việc và thông báo liên quan.'}
        month={month}
        onMonthChange={setMonth}
      />

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={loadDashboard} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      <WarehouseKpiGrid items={kpis} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <WarehouseTaskTable
            title={isManager ? 'Hoạt động kho của đội' : 'Công việc kho của tôi'}
            rows={isManager ? (data?.teamActivity || []) : (data?.myTasks || [])}
            mode={isManager ? 'team' : 'mine'}
            viewAllTo="/warehouse"
          />
        </div>
        <WarehouseScheduleTimeline
          title={isManager ? 'Lịch phòng kho hôm nay' : 'Lịch làm việc hôm nay'}
          dateLabel={todayLabel()}
          items={scheduleItems}
          onAdd={() => navigate('/warehouse')}
        />
      </div>

      {isManager ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <WarehouseInventoryAlertChart items={data?.inventoryAlerts || []} top={top} onTopChange={setTop} />
            <WarehouseDocumentTypeChart items={data?.docTypeRatio || []} monthLabel={monthLabel} />
            <WarehouseApprovalList
              items={data?.pendingApprovals || []}
              canApprove={rbac.canApprove('warehouse')}
              onChanged={loadDashboard}
            />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <WarehouseRecentMessages />
            <WarehouseUpcomingMeetings />
            <WarehouseNotificationList />
          </div>
        </>
      ) : (
        <WarehouseNotificationList limit={8} />
      )}
    </div>
  );
}
