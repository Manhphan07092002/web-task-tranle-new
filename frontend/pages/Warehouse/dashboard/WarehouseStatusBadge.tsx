import { TX_STATUS_META } from './warehouseLabels';

export function WarehouseStatusBadge({ status }: { status: string }) {
  const meta = TX_STATUS_META[status] || { label: status, badge: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`px-2 py-1 rounded font-bold text-xs whitespace-nowrap ${meta.badge}`}>
      {meta.label}
    </span>
  );
}
